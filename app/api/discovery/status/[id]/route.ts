import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import {
  getApifyRun,
  readApifyDataset,
} from "@/lib/apify/client"
import { normalizeApifyItems } from "@/lib/discovery/apify-normalize"
import { persistBusinesses } from "@/lib/discovery/persist"
import { searchOpenStreetMap } from "@/lib/discovery/sources/openstreetmap"
import type {
  DiscoveryRequest,
  DiscoverySource,
} from "@/lib/discovery/types"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

const FAILED_STATUSES = new Set([
  "failed",
  "aborted",
  "timed-out",
  "timed_out",
])

function parseJson<T>(
  value: string | null,
  fallback: T,
): T {
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

function isFinishedSource(source: {
  imported: boolean
  status: string
}): boolean {
  return (
    source.imported ||
    FAILED_STATUSES.has(normalizeStatus(source.status))
  )
}

function completedSourceCount(
  sources: Array<{
    imported: boolean
    status: string
  }>,
): number {
  return sources.filter(isFinishedSource).length
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
    radiusKm: searchRun.radiusKm || 35,
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

async function markSourceFailed(
  sourceRunId: string,
  error: unknown,
): Promise<void> {
  await prisma.sourceRun.update({
    where: { id: sourceRunId },
    data: {
      status: "failed",
      error:
        error instanceof Error
          ? error.message
          : "Source processing failed",
      completedAt: new Date(),
    },
  })
}

async function processApifySource(
  sourceRun: {
    id: string
    searchRunId: string
    source: string
    providerRunId: string | null
    imported: boolean
  },
  request: DiscoveryRequest,
): Promise<void> {
  if (sourceRun.imported) return

  if (!sourceRun.providerRunId) {
    await markSourceFailed(
      sourceRun.id,
      new Error("Provider run was not created"),
    )
    return
  }

  try {
    const remoteRun = await getApifyRun(
      sourceRun.providerRunId,
    )

    if (!remoteRun) {
      await markSourceFailed(
        sourceRun.id,
        new Error("Provider run could not be found"),
      )
      return
    }

    const status = normalizeStatus(remoteRun.status)

    if (FAILED_STATUSES.has(status)) {
      await prisma.sourceRun.update({
        where: { id: sourceRun.id },
        data: {
          status,
          datasetId: remoteRun.datasetId,
          completedAt: new Date(),
        },
      })
      return
    }

    if (status !== "succeeded") {
      await prisma.sourceRun.update({
        where: { id: sourceRun.id },
        data: {
          status,
          datasetId: remoteRun.datasetId,
        },
      })
      return
    }

    const items = await readApifyDataset(
      remoteRun.datasetId,
    )

    const records = normalizeApifyItems(
      sourceRun.source as DiscoverySource,
      items,
    )

    const totalLinked = await persistBusinesses(
      sourceRun.searchRunId,
      records,
      request,
    )

    await prisma.sourceRun.update({
      where: { id: sourceRun.id },
      data: {
        status: "succeeded",
        datasetId: remoteRun.datasetId,
        imported: true,
        importedCount: records.length,
        importedAt: new Date(),
        completedAt: new Date(),
      },
    })

    await prisma.searchRun.update({
      where: { id: sourceRun.searchRunId },
      data: {
        resultCount: totalLinked,
      },
    })
  } catch (error) {
    console.error(
      `Source processing failed for ${sourceRun.source}:`,
      error,
    )

    await markSourceFailed(sourceRun.id, error)
  }
}

async function processOpenStreetMap(
  sourceRun: {
    id: string
    searchRunId: string
  },
  request: DiscoveryRequest,
): Promise<void> {
  await prisma.sourceRun.update({
    where: { id: sourceRun.id },
    data: {
      status: "running",
      error: null,
    },
  })

  try {
    const records = await searchOpenStreetMap(request)

    const totalLinked = await persistBusinesses(
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
      },
    })

    await prisma.searchRun.update({
      where: { id: sourceRun.searchRunId },
      data: {
        resultCount: totalLinked,
      },
    })
  } catch (error) {
    console.error("OpenStreetMap discovery failed:", error)
    await markSourceFailed(sourceRun.id, error)
  }
}

export async function GET(
  _request: Request,
  context: { params: { id: string } },
) {
  try {
    const searchRun = await prisma.searchRun.findUnique({
      where: { id: context.params.id },
      include: {
        sourceRuns: {
          orderBy: { createdAt: "asc" },
        },
      },
    })

    if (!searchRun) {
      return NextResponse.json(
        { error: "Search not found." },
        { status: 404 },
      )
    }

    if (
      searchRun.status === "completed" ||
      searchRun.status === "failed"
    ) {
      return NextResponse.json({
        searchRunId: searchRun.id,
        status: searchRun.status,
        resultCount: searchRun.resultCount,
        completedSources: completedSourceCount(
          searchRun.sourceRuns,
        ),
        totalSources: searchRun.sourceRuns.length,
      })
    }

    const discoveryRequest = buildRequest(searchRun)

    const activeApifySources =
      searchRun.sourceRuns.filter(
        (source) =>
          source.source !== "openstreetmap" &&
          !isFinishedSource(source),
      )

    await Promise.allSettled(
      activeApifySources.map((source) =>
        processApifySource(
          {
            id: source.id,
            searchRunId: source.searchRunId,
            source: source.source,
            providerRunId: source.providerRunId,
            imported: source.imported,
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

    let resultCount =
      await prisma.searchRunBusiness.count({
        where: {
          searchRunId: searchRun.id,
        },
      })

    const apifySources = refreshedSources.filter(
      (source) => source.source !== "openstreetmap",
    )

    const apifyFinished =
      apifySources.length === 0 ||
      apifySources.every(isFinishedSource)

    const pendingOpenStreetMap =
      refreshedSources.find(
        (source) =>
          source.source === "openstreetmap" &&
          source.status === "pending",
      )

    if (
      pendingOpenStreetMap &&
      apifyFinished &&
      resultCount < discoveryRequest.maxResults
    ) {
      await processOpenStreetMap(
        {
          id: pendingOpenStreetMap.id,
          searchRunId: searchRun.id,
        },
        discoveryRequest,
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

      resultCount =
        await prisma.searchRunBusiness.count({
          where: {
            searchRunId: searchRun.id,
          },
        })
    }

    const ageMs =
      Date.now() - searchRun.createdAt.getTime()

    const targetReached =
      resultCount >= discoveryRequest.maxResults

    const allFinished =
      refreshedSources.every(isFinishedSource)

    const stale = ageMs > 180_000

    let finalStatus:
      | "running"
      | "completed"
      | "failed" = "running"

    if (targetReached || allFinished || stale) {
      finalStatus =
        resultCount > 0 ? "completed" : "failed"

      if (stale) {
        await prisma.sourceRun.updateMany({
          where: {
            searchRunId: searchRun.id,
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
            error: "Source exceeded the search time limit",
            completedAt: new Date(),
          },
        })
      }

      await prisma.searchRun.update({
        where: { id: searchRun.id },
        data: {
          status: finalStatus,
          resultCount,
          completedAt: new Date(),
          error:
            finalStatus === "failed"
              ? "No usable results were returned."
              : null,
        },
      })
    } else {
      await prisma.searchRun.update({
        where: { id: searchRun.id },
        data: {
          status: "running",
          resultCount,
        },
      })
    }

    return NextResponse.json({
      searchRunId: searchRun.id,
      status: finalStatus,
      resultCount,
      completedSources:
        completedSourceCount(refreshedSources),
      totalSources: refreshedSources.length,
    })
  } catch (error) {
    console.error("Discovery status failed:", error)

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Search status could not be checked.",
      },
      { status: 500 },
    )
  }
}
