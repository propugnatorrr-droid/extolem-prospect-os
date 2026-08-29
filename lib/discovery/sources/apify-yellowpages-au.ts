// Apify YellowPages Australia scraper (mamies/yellowpages-australia-scraper).
// This actor is less widely documented than Compass, so field mapping is
// defensive (tries common alternate key names). Verify against a real
// dataset item once you've run it once, and tighten this mapping.
import { runApifyActor, readApifyDataset } from "@/lib/apify/client"
import type { DiscoveryRequest, NormalizedBusiness } from "../types"

const ACTOR_ID = "mamies/yellowpages-australia-scraper"

type RawItem = Record<string, unknown>

function pick(item: RawItem, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = item[key]
    if (typeof value === "string" && value.trim()) return value.trim()
  }
  return undefined
}

export async function searchYellowPagesAu(request: DiscoveryRequest): Promise<NormalizedBusiness[]> {
  const { datasetId } = await runApifyActor(ACTOR_ID, {
    searchTerm: request.categories.join(", "),
    location: request.location,
    maxResults: request.maxResults,
  })

  const items = (await readApifyDataset(datasetId)) as RawItem[]

  const results: NormalizedBusiness[] = []
  for (const item of items) {
    const name = pick(item, "name", "businessName", "title")
    if (!name) continue
    results.push({
      source: "yellowpages_au",
      sourceId: pick(item, "id", "listingId"),
      sourceUrl: pick(item, "url", "listingUrl"),
      name,
      category: pick(item, "category", "categoryName"),
      phone: pick(item, "phone", "phoneNumber"),
      website: pick(item, "website", "websiteUrl"),
      street: pick(item, "street", "streetAddress"),
      suburb: pick(item, "suburb", "city", "locality"),
      state: pick(item, "state"),
      postcode: pick(item, "postcode", "postalCode"),
      country: "AU",
      raw: item,
    })
  }
  return results
}
