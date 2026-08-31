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

const TERMINAL_STATUSES = new Set([
  "succeeded",
  "failed",
  "aborted",
  "timed-out",
])

function parseJson<T>(value: string | null, fallback: T): T {
  if (!value) return fallback

  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

function buildRequest(
  searchRun: {
    categories: string
    location: string
    radiusKm: number | null
    sources: string
    filters: string | null
  },
): DiscoveryRequest {
  const filters = parseJson<Record<string, unknown>>(
    searchRun.filters,
    {},
  )

  return {
    categories: parseJson<string[]>(searchRun.categories, []),
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

async function processOpenStreetMap(
  sourceRun: {
    id: string
    searchRunId: string
  },
  request: DiscoveryRequest,
) {
  await prisma.sourceRun.update({
    where: { id: sourceRun.id },
    data: { status: "running" },
  })

  try {
    const records = await searchOpenStreetMap(request)

    const count = await persistBusinesses(
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

    return count
  } catch (error) {
    console.error("OpenStreetMap discovery failed:", error)

    await prisma.sourceRun.update({
      where: { id: sourceRun.id },
      data: {
        status: "failed",
        error:
          error instanceof Error
            ? error.message
            : "Map discovery failed",
        completedAt: new Date(),
      },
    })

    return 0
  }
}

async function processApifySource(
  sourceRun: {
    id: string
    searchRunId: string
    source: string
    providerRunId: string | null
    datasetId: string | null
    imported: boolean
  },
  request: DiscoveryRequest,
) {
  if (!sourceRun.providerRunId) return

  const remoteRun = await getApifyRun(sourceRun.providerRunId)

  if (!remoteRun) {
    await prisma.sourceRun.update({
      where: { id: sourceRun.id },
      data: {
        status: "failed",
        error: "Remote run could not be found",
        completedAt: new Date(),
      },
    })

    return
  }

  const status = remoteRun.status.toLowerCase()

  await prisma.sourceRun.update({
    where: { id: sourceRun.id },
    data: {
      status,
      datasetId: remoteRun.datasetId,
      completedAt: TERMINAL_STATUSES.has(status)
        ? new Date()
        : undefined,
    },
  })

  if (status !== "succeeded" || sourceRun.imported) return

  const items = await readApifyDataset(remoteRun.datasetId)
  const records = normalizeApifyItems(
    sourceRun.source as DiscoverySource,
    items,
  )

  await persistBusinesses(
    sourceRun.searchRunId,
    records,
    request,
  )

  await prisma.sourceRun.update({
    where: { id: sourceRun.id },
    data: {
      imported: true,
      importedCount: records.length,
      importedAt: new Date(),
    },
  })
}

export async function GET(
  _request: Request,
  context: { params: { id: string } },
) {
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
      completedSources: searchRun.sourceRuns.filter(
        (source) => source.imported,
      ).length,
      totalSources: searchRun.sourceRuns.length,
    })
  }

  const discoveryRequest = buildRequest(searchRun)

  const pendingOsm = searchRun.sourceRuns.find(
    (source) =>
      source.source === "openstreetmap" &&
      source.status === "pending",
  )

  if (pendingOsm) {
    await processOpenStreetMap(
      {
        id: pendingOsm.id,
        searchRunId: searchRun.id,
      },
      discoveryRequest,
    )
  } else {
    const apifySource = searchRun.sourceRuns.find(
      (source) =>
        source.source !== "openstreetmap" &&
        !source.imported &&
        !["failed", "aborted", "timed-out"].includes(
          source.status,
        ),
    )

    if (apifySource) {
      try {
        await processApifySource(
          {
            id: apifySource.id,
            searchRunId: searchRun.id,
            source: apifySource.source,
            providerRunId: apifySource.providerRunId,
            datasetId: apifySource.datasetId,
            imported: apifySource.imported,
          },
          discoveryRequest,
        )
      } catch (error) {
        console.error(
          `Source processing failed for ${apifySource.source}:`,
          error,
        )

        await prisma.sourceRun.update({
          where: { id: apifySource.id },
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
    }
  }

  const refreshedSources = await prisma.sourceRun.findMany({
    where: { searchRunId: searchRun.id },
  })

  const resultCount = await prisma.searchRunBusiness.count({
    where: { searchRunId: searchRun.id },
  })

  const allTerminal = refreshedSources.every(
    (source) =>
      source.imported ||
      ["failed", "aborted", "timed-out"].includes(source.status),
  )

  const successfulSources = refreshedSources.filter(
    (source) => source.imported,
  ).length

  let finalStatus = "running"

  if (allTerminal) {
    finalStatus =
      successfulSources > 0 || resultCount > 0
        ? "completed"
        : "failed"

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
    completedSources: refreshedSources.filter(
      (source) => source.imported,
    ).length,
    totalSources: refreshedSources.length,
  })
}
