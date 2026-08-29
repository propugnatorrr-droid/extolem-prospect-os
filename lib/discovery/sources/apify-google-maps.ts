// Apify Compass Google Maps Scraper (apify/compass~crawler-google-places).
// Field names match the actor's documented output schema as of writing —
// verify against a real run's dataset once APIFY_TOKEN is set, since Apify
// actors can change their output shape without notice.
import { runApifyActor, readApifyDataset } from "@/lib/apify/client"
import type { DiscoveryRequest, NormalizedBusiness } from "../types"

const ACTOR_ID = "compass/crawler-google-places"

interface CompassItem {
  title?: string
  categoryName?: string
  phone?: string
  phoneUnformatted?: string
  website?: string
  street?: string
  city?: string
  state?: string
  postalCode?: string
  countryCode?: string
  location?: { lat?: number; lng?: number }
  totalScore?: number
  reviewsCount?: number
  placeId?: string
  url?: string
  permanentlyClosed?: boolean
  temporarilyClosed?: boolean
}

export async function searchGoogleMapsApify(request: DiscoveryRequest): Promise<NormalizedBusiness[]> {
  const { datasetId } = await runApifyActor(ACTOR_ID, {
    searchStringsArray: request.categories,
    locationQuery: request.location,
    maxCrawledPlacesPerSearch: request.maxResults,
    language: "en",
    countryCode: "au",
    scrapePlaceDetailPage: true,
    scrapeReviewsPersonalData: false,
  })

  const items = (await readApifyDataset(datasetId)) as unknown as CompassItem[]

  return items
    .filter((item) => !item.permanentlyClosed && !item.temporarilyClosed && item.title)
    .map((item) => ({
      source: "google_maps_apify" as const,
      sourceId: item.placeId,
      sourceUrl: item.url,
      name: item.title!,
      category: item.categoryName,
      phone: item.phoneUnformatted || item.phone,
      website: item.website,
      street: item.street,
      suburb: item.city,
      state: item.state,
      postcode: item.postalCode,
      country: item.countryCode?.toUpperCase() || "AU",
      latitude: item.location?.lat,
      longitude: item.location?.lng,
      rating: item.totalScore,
      reviewCount: item.reviewsCount,
      raw: item as Record<string, unknown>,
    }))
}
