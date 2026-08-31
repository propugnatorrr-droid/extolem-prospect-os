import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import {
  getApifyRun,
  readApifyDataset,
} from "@/lib/apify/client"
import { normalizeApifyItems } from "@/lib/discovery/apify-normalize"
import { persistBusinesses } from "@/lib/discovery/persist"
import { searchGooglePlaces } from "@/lib/discovery/sources/google-places"
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

function normalizedStatus(status: string): string {
  return status.toLowerCase().replaceAll("_", "-")
}

function sourceFinished(source: {
  imported: boolean
  status: string
}): boolean {
  return (
    source.imported ||
    FAILED_STATUSES.has(normalizedStatus(source.status))
  )
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

async function failSource(
  id: string,
  error: unknown,
): Promise<void> {
  await prisma.sourceRun.update({
    where: { id },
    data: {
      status: "failed",
      error:
        error instanceof Error
          ? error.message
          : "Source failed",
      completedAt: new Date(),
    },
  })
}

async function processDirectSource(
  sourceRun: {
    id: string
    searchRunId: string
    source: string
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
    const records =
      sourceRun.source === "google_places_api"
        ? await searchGooglePlaces(request)
        : await searchOpenStreetMap(request)

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
      },
    })

    await prisma.searchRun.update({
      where: { id: sourceRun.searchRunId },
      data: { resultCount },
    })
  } catch (error) {
    console.error(
      `${sourceRun.source} discovery failed:`,
      error,
    )
    await failSource(sourceRun.id, error)
  }
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
    await failSource(
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
      await failSource(
        sourceRun.id,
        new Error("Provider run could not be found"),
      )
      return
    }

    const status = normalizedStatus(remoteRun.status)

    if (FAILED_STATUSES.has(status)) {
      await failSource(
        sourceRun.id,
        new Error(`Provider finished with ${status}`),
      )
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
        datasetId: remoteRun.datasetId,
        importedAt: new Date(),
        completedAt: new Date(),
      },
    })

    await prisma.searchRun.update({
      where: { id: sourceRun.searchRunId },
      data: { resultCount },
    })
  } catch (error) {
    await failSource(sourceRun.id, error)
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
        completedSources:
          searchRun.sourceRuns.filter(sourceFinished).length,
        totalSources: searchRun.sourceRuns.length,
      })
    }

    const discoveryRequest = buildRequest(searchRun)

    const googlePlaces =
      searchRun.sourceRuns.find(
        (source) =>
          source.source === "google_places_api" &&
          source.status === "pending",
      )

    if (googlePlaces) {
      await processDirectSource(
        {
          id: googlePlaces.id,
          searchRunId: searchRun.id,
          source: googlePlaces.source,
        },
        discoveryRequest,
      )
    }

    const apifySources =
      searchRun.sourceRuns.filter(
        (source) =>
          ![
            "google_places_api",
            "openstreetmap",
          ].includes(source.source) &&
          !sourceFinished(source),
      )

    await Promise.allSettled(
      apifySources.map((source) =>
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

    let refreshed =
      await prisma.sourceRun.findMany({
        where: { searchRunId: searchRun.id },
        orderBy: { createdAt: "asc" },
      })

    let resultCount =
      await prisma.searchRunBusiness.count({
        where: { searchRunId: searchRun.id },
      })

    const otherSourcesFinished = refreshed
      .filter(
        (source) => source.source !== "openstreetmap",
      )
      .every(sourceFinished)

    const openStreetMap = refreshed.find(
      (source) =>
        source.source === "openstreetmap" &&
        source.status === "pending",
    )

    if (
      openStreetMap &&
      otherSourcesFinished &&
      resultCount < discoveryRequest.maxResults
    ) {
      await processDirectSource(
        {
          id: openStreetMap.id,
          searchRunId: searchRun.id,
          source: openStreetMap.source,
        },
        discoveryRequest,
      )

      refreshed =
        await prisma.sourceRun.findMany({
          where: { searchRunId: searchRun.id },
          orderBy: { createdAt: "asc" },
        })

      resultCount =
        await prisma.searchRunBusiness.count({
          where: { searchRunId: searchRun.id },
        })
    }

    const stale =
      Date.now() - searchRun.createdAt.getTime() > 180_000

    const allFinished =
      refreshed.every(sourceFinished)

    let status: "running" | "completed" | "failed" =
      "running"

    if (allFinished || stale) {
      status = resultCount > 0 ? "completed" : "failed"

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
            error: "Provider exceeded the search limit",
            completedAt: new Date(),
          },
        })
      }

      await prisma.searchRun.update({
        where: { id: searchRun.id },
        data: {
          status,
          resultCount,
          completedAt: new Date(),
          error:
            status === "failed"
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
      status,
      resultCount,
      completedSources:
        refreshed.filter(sourceFinished).length,
      totalSources: refreshed.length,
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
