import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/db"
import { startDiscoveryActor } from "@/lib/discovery/apify-jobs"
import type {
  DiscoveryRequest,
  DiscoverySource,
} from "@/lib/discovery/types"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

const AUTOMATIC_SOURCES: DiscoverySource[] = [
  "google_maps_apify",
  "yellowpages_au",
  "google_search_apify",
  "openstreetmap",
]

const requestSchema = z.object({
  categories: z.array(z.string().trim().min(2)).min(1).max(8),
  location: z.string().trim().min(2),
  radiusKm: z.number().min(1).max(500).default(35),
  maxResults: z.number().int().min(1).max(500).default(50),
  minimumRating: z.preprocess(
    (value) => value === null || value === "" ? undefined : value,
    z.coerce.number().min(0).max(5).optional(),
  ),
  minimumReviews: z.preprocess(
    (value) => value === null || value === "" ? undefined : value,
    z.coerce.number().int().min(0).optional(),
  ),

  requirePhone: z.boolean().default(true),
  requireWebsite: z.boolean().default(false),
})

export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  const parsed = requestSchema.safeParse(body)

  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Check the business type and location, then try again.",
      },
      { status: 400 },
    )
  }

  const discoveryRequest: DiscoveryRequest = {
    ...parsed.data,
    sources: AUTOMATIC_SOURCES,
  }

  const searchRun = await prisma.searchRun.create({
    data: {
      query: discoveryRequest.categories.join(", "),
      categories: JSON.stringify(discoveryRequest.categories),
      location: discoveryRequest.location,
      radiusKm: discoveryRequest.radiusKm,
      sources: JSON.stringify(AUTOMATIC_SOURCES),
      filters: JSON.stringify({
        maxResults: discoveryRequest.maxResults,
        minimumRating: discoveryRequest.minimumRating,
        minimumReviews: discoveryRequest.minimumReviews,
        requirePhone: discoveryRequest.requirePhone,
        requireWebsite: discoveryRequest.requireWebsite,
      }),
      status: "starting",
    },
  })

  await prisma.sourceRun.create({
    data: {
      searchRunId: searchRun.id,
      source: "openstreetmap",
      status: "pending",
    },
  })

  const apifySources = AUTOMATIC_SOURCES.filter(
    (source) => source !== "openstreetmap",
  )

  await Promise.all(
    apifySources.map(async (source) => {
      const sourceRun = await prisma.sourceRun.create({
        data: {
          searchRunId: searchRun.id,
          source,
          status: "starting",
        },
      })

      try {
        const actorRun = await startDiscoveryActor(
          source,
          discoveryRequest,
        )

        await prisma.sourceRun.update({
          where: { id: sourceRun.id },
          data: {
            providerRunId: actorRun.runId,
            datasetId: actorRun.datasetId,
            status: actorRun.status.toLowerCase(),
          },
        })
      } catch (error) {
        console.error(`Could not start ${source}:`, error)

        await prisma.sourceRun.update({
          where: { id: sourceRun.id },
          data: {
            status: "failed",
            error:
              error instanceof Error
                ? error.message
                : "Source could not be started",
            completedAt: new Date(),
          },
        })
      }
    }),
  )

  await prisma.searchRun.update({
    where: { id: searchRun.id },
    data: { status: "running" },
  })

  return NextResponse.json(
    {
      searchRunId: searchRun.id,
      status: "running",
      message: "Your prospecting run has started.",
    },
    { status: 202 },
  )
}
