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

const requestSchema = z.object({
  categories: z.array(z.string().trim().min(2)).min(1).max(8),
  location: z.string().trim().min(2),
  radiusKm: z.coerce.number().min(1).max(500).default(35),
  maxResults: z.coerce.number().int().min(1).max(200).default(50),
  minimumRating: z.preprocess(
    (value) =>
      value === null || value === "" ? undefined : value,
    z.coerce.number().min(0).max(5).optional(),
  ),
  minimumReviews: z.preprocess(
    (value) =>
      value === null || value === "" ? undefined : value,
    z.coerce.number().int().min(0).optional(),
  ),
  requirePhone: z.boolean().default(true),
  requireWebsite: z.boolean().default(false),
})

function getAutomaticSources(
  requirePhone: boolean,
): DiscoverySource[] {
  const sources: DiscoverySource[] = []

  if (process.env.GOOGLE_PLACES_API_KEY) {
    sources.push("google_places_api")
  }

  if (
    process.env.ENABLE_APIFY === "true" &&
    process.env.APIFY_TOKEN
  ) {
    sources.push(
      "google_maps_apify",
      "yellowpages_au",
      "google_search_apify",
    )
  }

  if (!requirePhone || sources.length === 0) {
    sources.push("openstreetmap")
  }

  return sources
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null)
    const parsed = requestSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        {
          error:
            "Check the business type and location, then try again.",
        },
        { status: 400 },
      )
    }

    const sources = getAutomaticSources(
      parsed.data.requirePhone,
    )

    const discoveryRequest: DiscoveryRequest = {
      ...parsed.data,
      sources,
    }

    const searchRun = await prisma.searchRun.create({
      data: {
        query: discoveryRequest.categories.join(", "),
        categories: JSON.stringify(
          discoveryRequest.categories,
        ),
        location: discoveryRequest.location,
        radiusKm: discoveryRequest.radiusKm,
        sources: JSON.stringify(sources),
        filters: JSON.stringify({
          maxResults: discoveryRequest.maxResults,
          minimumRating:
            discoveryRequest.minimumRating,
          minimumReviews:
            discoveryRequest.minimumReviews,
          requirePhone: discoveryRequest.requirePhone,
          requireWebsite:
            discoveryRequest.requireWebsite,
        }),
        status: "starting",
      },
    })

    const sourceRuns = await Promise.all(
      sources.map((source) =>
        prisma.sourceRun.create({
          data: {
            searchRunId: searchRun.id,
            source,
            status:
              source === "google_places_api" ||
              source === "openstreetmap"
                ? "pending"
                : "starting",
          },
        }),
      ),
    )

    const apifyRuns = sourceRuns.filter(
      (sourceRun) =>
        sourceRun.source !== "google_places_api" &&
        sourceRun.source !== "openstreetmap",
    )

    await Promise.allSettled(
      apifyRuns.map(async (sourceRun) => {
        try {
          const actorRun = await startDiscoveryActor(
            sourceRun.source as DiscoverySource,
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
      },
      { status: 202 },
    )
  } catch (error) {
    console.error("Discovery start failed:", error)

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "The search could not be started.",
      },
      { status: 500 },
    )
  }
}
