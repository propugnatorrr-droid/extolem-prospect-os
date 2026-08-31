import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import {
  abortApifyRun,
  getApifyRun,
  readApifyDataset,
} from "@/lib/apify/client"
import { normalizeApifyItems } from "@/lib/discovery/apify-normalize"
import {
  isDirectSource,
  runDirectSource,
} from "@/lib/discovery/direct-sources"
import { isApifySource } from "@/lib/discovery/apify-jobs"
import { persistBusinesses } from "@/lib/discovery/persist"
import type {
  DiscoveryRequest,
  DiscoverySource,
} from "@/lib/discovery/types"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

const SEARCH_TIMEOUT_MS = 180_000

const FAILED_STATUSES = new Set([
  "failed",
  "aborted",
  "timed-out",
  "timed_out",
])

interface SourceRunSummary {
  id: string
  searchRunId: string
  source: string
  status: string
  imported: boolean
  providerRunId: string | null
  datasetId: string | null
}

function parseJson<T>(value: string | null, fallback: T): T {
  if (!value) return fallback

  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

function normalizeStatus(status: string): string {
  return status.toLowerCase().replaceAll("_", "-")
}

function sourceFinished(source: {
  imported: boolean
  status: string
}): boolean {
  return (
    source.imported ||
    FAILED_STATUSES.has(normalizeStatus(source.status))
  )
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message
    ? error.message
    : fallback
}

function buildRequest(searchRun: {
  categories: string
  location: string
  radiusKm: number | null
  sources: string
  filters: string | null
}): DiscoveryRequest {
  const filters = parseJson<Record<string, unknown>>(
    searchRun.filters,
    {},
  )

  return {
    categories: parseJson<string[]>(
      searchRun.categories,
      [],
    ),
    location: searchRun.location,
    radiusKm: searchRun.radiusKm ?? 35,
    sources: parseJson<DiscoverySource[]>(
      searchRun.sources,
      [],
    ),
    maxResults:
      typeof filters.maxResults === "number"
        ? filters.maxResults
        : 50,
    minimumRating:
      typeof filters.minimumRating === "number"
        ? filters.minimumRating
        : undefined,
    minimumReviews:
      typeof filters.minimumReviews === "number"
        ? filters.minimumReviews
        : undefined,
    requirePhone:
      typeof filters.requirePhone === "boolean"
        ? filters.requirePhone
        : true,
    requireWebsite:
      typeof filters.requireWebsite === "boolean"
        ? filters.requireWebsite
        : false,
  }
}

async function countResults(searchRunId: string): Promise<number> {
  return prisma.searchRunBusiness.count({
    where: { searchRunId },
  })
}

async function failSource(
  sourceRunId: string,
  error: unknown,
): Promise<void> {
  await prisma.sourceRun.update({
    where: { id: sourceRunId },
    data: {
      status: "failed",
      imported: false,
      error: errorMessage(
        error,
        "The discovery source failed.",
      ),
      completedAt: new Date(),
    },
  })
}

async function processDirectSource(
  sourceRun: SourceRunSummary,
  request: DiscoveryRequest,
): Promise<void> {
  const source = sourceRun.source as DiscoverySource

  if (!isDirectSource(source)) return
  if (sourceFinished(sourceRun)) return

  /*
   * Claim the source before processing it. This prevents two simultaneous
   * browser polling requests from running the same direct provider twice.
   */
  const claimed = await prisma.sourceRun.updateMany({
    where: {
      id: sourceRun.id,
      imported: false,
      status: {
        in: ["pending", "starting"],
      },
    },
    data: {
      status: "running",
      error: null,
    },
  })

  if (claimed.count === 0) return

  try {
    const records = await runDirectSource(
      source,
      request,
    )

    const resultCount = await persistBusinesses(
      sourceRun.searchRunId,
      records,
      request,
    )

    await prisma.sourceRun.update({
      where: { id: sourceRun.id },
      data: {
        status: "succeeded",
        imported: true,
        importedCount: records.length,
        importedAt: new Date(),
        completedAt: new Date(),
        error: null,
      },
    })

    await prisma.searchRun.update({
      where: { id: sourceRun.searchRunId },
      data: {
        status: "running",
        resultCount,
        error: null,
      },
    })
  } catch (error) {
    console.error(
      `${sourceRun.source} direct discovery failed:`,
      error,
    )

    await failSource(sourceRun.id, error)
  }
}

async function processApifySource(
  sourceRun: SourceRunSummary,
  request: DiscoveryRequest,
): Promise<void> {
  const source = sourceRun.source as DiscoverySource

  if (!isApifySource(source)) return
  if (sourceRun.imported) return
  if (FAILED_STATUSES.has(normalizeStatus(sourceRun.status))) {
    return
  }

  if (!sourceRun.providerRunId) {
    await failSource(
      sourceRun.id,
      new Error("The provider run was not created."),
    )
    return
  }

  try {
    const remoteRun = await getApifyRun(
      sourceRun.providerRunId,
    )

    if (!remoteRun) {
      await failSource(
        sourceRun.id,
        new Error("The provider run could not be found."),
      )
      return
    }

    const remoteStatus = normalizeStatus(
      remoteRun.status,
    )

    if (FAILED_STATUSES.has(remoteStatus)) {
      await failSource(
        sourceRun.id,
        new Error(
          `The provider finished with status ${remoteStatus}.`,
        ),
      )
      return
    }

    if (remoteStatus !== "succeeded") {
      await prisma.sourceRun.update({
        where: { id: sourceRun.id },
        data: {
          status: remoteStatus,
          datasetId:
            remoteRun.datasetId ||
            sourceRun.datasetId,
          error: null,
        },
      })

      return
    }

    const datasetId =
      remoteRun.datasetId || sourceRun.datasetId

    if (!datasetId) {
      await failSource(
        sourceRun.id,
        new Error(
          "The provider completed without a dataset.",
        ),
      )
      return
    }

    const items = await readApifyDataset(datasetId)

    const records = normalizeApifyItems(
      source,
      items,
    )

    const resultCount = await persistBusinesses(
      sourceRun.searchRunId,
      records,
      request,
    )

    await prisma.sourceRun.update({
      where: { id: sourceRun.id },
      data: {
        status: "succeeded",
        imported: true,
        importedCount: records.length,
        datasetId,
        importedAt: new Date(),
        completedAt: new Date(),
        error: null,
      },
    })

    await prisma.searchRun.update({
      where: { id: sourceRun.searchRunId },
      data: {
        status: "running",
        resultCount,
        error: null,
      },
    })
  } catch (error) {
    console.error(
      `${sourceRun.source} Apify discovery failed:`,
      error,
    )

    await failSource(sourceRun.id, error)
  }
}

async function stopUnfinishedSources(
  sourceRuns: SourceRunSummary[],
  reason: string,
): Promise<void> {
  const unfinished = sourceRuns.filter(
    (sourceRun) => !sourceFinished(sourceRun),
  )

  await Promise.allSettled(
    unfinished.map(async (sourceRun) => {
      const source =
        sourceRun.source as DiscoverySource

      if (
        isApifySource(source) &&
        sourceRun.providerRunId
      ) {
        try {
          await abortApifyRun(
            sourceRun.providerRunId,
          )
        } catch (error) {
          console.warn(
            `Could not abort ${sourceRun.source}:`,
            error,
          )
        }
      }

      await prisma.sourceRun.updateMany({
        where: {
          id: sourceRun.id,
          imported: false,
          status: {
            notIn: [
              "failed",
              "aborted",
              "timed-out",
              "timed_out",
            ],
          },
        },
        data: {
          status: "aborted",
          error: reason,
          completedAt: new Date(),
        },
      })
    }),
  )
}

async function timeoutUnfinishedSources(
  searchRunId: string,
): Promise<void> {
  await prisma.sourceRun.updateMany({
    where: {
      searchRunId,
      imported: false,
      status: {
        notIn: [
          "failed",
          "aborted",
          "timed-out",
          "timed_out",
        ],
      },
    },
    data: {
      status: "timed-out",
      error:
        "The provider exceeded the search time limit.",
      completedAt: new Date(),
    },
  })
}

function statusResponse(
  searchRunId: string,
  status: string,
  resultCount: number,
  sourceRuns: Array<{
    imported: boolean
    status: string
  }>,
) {
  return NextResponse.json({
    searchRunId,
    status,
    resultCount,
    completedSources:
      sourceRuns.filter(sourceFinished).length,
    totalSources: sourceRuns.length,
  })
}

export async function GET(
  _request: Request,
  context: { params: { id: string } },
) {
  try {
    const searchRun = await prisma.searchRun.findUnique({
      where: {
        id: context.params.id,
      },
      include: {
        sourceRuns: {
          orderBy: {
            createdAt: "asc",
          },
        },
      },
    })

    if (!searchRun) {
      return NextResponse.json(
        {
          error: "Search not found.",
        },
        {
          status: 404,
        },
      )
    }

    /*
     * Completed and failed searches do not need to call any
     * external providers again.
     */
    if (
      searchRun.status === "completed" ||
      searchRun.status === "failed"
    ) {
      return statusResponse(
        searchRun.id,
        searchRun.status,
        searchRun.resultCount,
        searchRun.sourceRuns,
      )
    }

    const discoveryRequest =
      buildRequest(searchRun)

    /*
     * Run all free direct providers concurrently:
     * - TomTom
     * - Geoapify
     * - OpenStreetMap
     *
     * One provider failing will not stop the others.
     */
    const directSources =
      searchRun.sourceRuns.filter((sourceRun) => {
        const source =
          sourceRun.source as DiscoverySource

        return (
          isDirectSource(source) &&
          !sourceFinished(sourceRun)
        )
      })

    await Promise.allSettled(
      directSources.map((sourceRun) =>
        processDirectSource(
          {
            id: sourceRun.id,
            searchRunId:
              sourceRun.searchRunId,
            source: sourceRun.source,
            status: sourceRun.status,
            imported: sourceRun.imported,
            providerRunId:
              sourceRun.providerRunId,
            datasetId:
              sourceRun.datasetId,
          },
          discoveryRequest,
        ),
      ),
    )

    /*
     * Poll all enabled Apify providers concurrently.
     * With ENABLE_APIFY=false this list will normally be empty.
     */
    const apifySources =
      searchRun.sourceRuns.filter((sourceRun) => {
        const source =
          sourceRun.source as DiscoverySource

        return (
          isApifySource(source) &&
          !sourceFinished(sourceRun)
        )
      })

    await Promise.allSettled(
      apifySources.map((sourceRun) =>
        processApifySource(
          {
            id: sourceRun.id,
            searchRunId:
              sourceRun.searchRunId,
            source: sourceRun.source,
            status: sourceRun.status,
            imported: sourceRun.imported,
            providerRunId:
              sourceRun.providerRunId,
            datasetId:
              sourceRun.datasetId,
          },
          discoveryRequest,
        ),
      ),
    )

    let refreshedSources =
      await prisma.sourceRun.findMany({
        where: {
          searchRunId: searchRun.id,
        },
        orderBy: {
          createdAt: "asc",
        },
      })

    let resultCount = await countResults(
      searchRun.id,
    )

    const targetReached =
      resultCount >= discoveryRequest.maxResults

    /*
     * Stop unused paid/remote jobs once the requested result target
     * has been reached.
     */
    if (targetReached) {
      await stopUnfinishedSources(
        refreshedSources,
        "The requested number of businesses was reached.",
      )

      refreshedSources =
        await prisma.sourceRun.findMany({
          where: {
            searchRunId: searchRun.id,
          },
          orderBy: {
            createdAt: "asc",
          },
        })
    }

    const stale =
      Date.now() -
        searchRun.createdAt.getTime() >
      SEARCH_TIMEOUT_MS

    if (stale && !targetReached) {
      await timeoutUnfinishedSources(
        searchRun.id,
      )

      refreshedSources =
        await prisma.sourceRun.findMany({
          where: {
            searchRunId: searchRun.id,
          },
          orderBy: {
            createdAt: "asc",
          },
        })
    }

    resultCount = await countResults(
      searchRun.id,
    )

    const allFinished =
      refreshedSources.length === 0 ||
      refreshedSources.every(sourceFinished)

    let finalStatus:
      | "running"
      | "completed"
      | "failed" = "running"

    if (
      targetReached ||
      allFinished ||
      stale
    ) {
      finalStatus =
        resultCount > 0
          ? "completed"
          : "failed"

      await prisma.searchRun.update({
        where: {
          id: searchRun.id,
        },
        data: {
          status: finalStatus,
          resultCount,
          completedAt: new Date(),
          error:
            finalStatus === "failed"
              ? "No usable businesses were returned by the available free providers."
              : null,
        },
      })
    } else {
      await prisma.searchRun.update({
        where: {
          id: searchRun.id,
        },
        data: {
          status: "running",
          resultCount,
          error: null,
        },
      })
    }

    return statusResponse(
      searchRun.id,
      finalStatus,
      resultCount,
      refreshedSources,
    )
  } catch (error) {
    console.error(
      "Discovery status failed:",
      error,
    )

    return NextResponse.json(
      {
        error: errorMessage(
          error,
          "Search status could not be checked.",
        ),
      },
      {
        status: 500,
      },
    )
  }
}
