import { prisma } from "@/lib/db"
import { isApifyConfigured } from "@/lib/apify/client"
import type { DiscoveryRequest, DiscoverySource, NormalizedBusiness } from "./types"
import { dedupeBusinesses } from "./dedupe"
import { searchOpenStreetMap } from "./sources/openstreetmap"
import { searchGoogleMapsApify } from "./sources/apify-google-maps"
import { searchYellowPagesAu } from "./sources/apify-yellowpages-au"
import { searchGoogleApify } from "./sources/apify-google-search"

const APIFY_SOURCES: DiscoverySource[] = ["google_maps_apify", "yellowpages_au", "google_search_apify"]

async function runSource(
  source: DiscoverySource,
  request: DiscoveryRequest,
): Promise<{ source: DiscoverySource; records: NormalizedBusiness[]; error?: string }> {
  try {
    if (APIFY_SOURCES.includes(source) && !isApifyConfigured()) {
      return { source, records: [], error: "This source is not set up yet." }
    }
    switch (source) {
      case "openstreetmap":
        return { source, records: await searchOpenStreetMap(request) }
      case "google_maps_apify":
        return { source, records: await searchGoogleMapsApify(request) }
      case "yellowpages_au":
        return { source, records: await searchYellowPagesAu(request) }
      case "google_search_apify":
        return { source, records: await searchGoogleApify(request) }
    }
  } catch (err) {
    // Log the real cause server-side only; the UI only ever sees a generic
    // message so implementation/vendor details never surface to end users.
    console.error(`discovery source ${source} failed:`, err)
    return { source, records: [], error: "This search source ran into a problem and was skipped." }
  }
}

export interface DiscoveryRunResult {
  searchRunId: string
  businessCount: number
  sourceErrors: Partial<Record<DiscoverySource, string>>
}

export async function runDiscovery(request: DiscoveryRequest): Promise<DiscoveryRunResult> {
  const searchRun = await prisma.searchRun.create({
    data: {
      query: request.categories.join(", "),
      categories: JSON.stringify(request.categories),
      location: request.location,
      radiusKm: request.radiusKm,
      sources: JSON.stringify(request.sources),
      status: "running",
    },
  })

  const sourceErrors: Partial<Record<DiscoverySource, string>> = {}

  try {
    const results = await Promise.all(request.sources.map((source) => runSource(source, request)))

    const allRecords: NormalizedBusiness[] = []
    for (const result of results) {
      if (result.error) sourceErrors[result.source] = result.error
      allRecords.push(...result.records)
    }

    const filtered = allRecords.filter((r) => {
      if (request.requirePhone && !r.phone) return false
      if (request.requireWebsite && !r.website) return false
      if (request.minimumRating && (r.rating ?? 0) < request.minimumRating) return false
      if (request.minimumReviews && (r.reviewCount ?? 0) < request.minimumReviews) return false
      return true
    })

    const groups = dedupeBusinesses(filtered)

    for (const group of groups.slice(0, request.maxResults)) {
      const b = group.business
      const business = await prisma.business.create({
        data: {
          name: b.name,
          category: b.category,
          phone: b.phone,
          website: b.website,
          street: b.street,
          suburb: b.suburb,
          state: b.state,
          postcode: b.postcode,
          country: b.country || "AU",
          latitude: b.latitude,
          longitude: b.longitude,
          rating: b.rating,
          reviewCount: b.reviewCount,
          placeId: b.source === "google_maps_apify" ? b.sourceId : undefined,
          searchRunId: searchRun.id,
        },
      })

      for (const src of group.sources) {
        await prisma.businessSource.create({
          data: {
            businessId: business.id,
            source: src.source,
            sourceId: src.sourceId,
            sourceUrl: src.sourceUrl,
            raw: JSON.stringify(src.raw),
          },
        }).catch(() => undefined) // unique constraint races are fine to skip
      }

      if (b.email) {
        await prisma.contact.create({
          data: { businessId: business.id, type: "email", value: b.email },
        })
      }
    }

    await prisma.searchRun.update({
      where: { id: searchRun.id },
      data: {
        status: "completed",
        resultCount: groups.length,
        completedAt: new Date(),
        error: Object.keys(sourceErrors).length ? JSON.stringify(sourceErrors) : null,
      },
    })

    return { searchRunId: searchRun.id, businessCount: groups.length, sourceErrors }
  } catch (err) {
    await prisma.searchRun.update({
      where: { id: searchRun.id },
      data: { status: "failed", error: err instanceof Error ? err.message : String(err) },
    })
    throw err
  }
}
