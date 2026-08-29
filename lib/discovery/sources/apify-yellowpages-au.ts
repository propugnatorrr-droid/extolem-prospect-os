// Apify YellowPages Australia scraper (mamies/yellowpages-australia-scraper).
// Field mapping verified against a real production dataset item 2026-08-29:
// { name, phone, full_address, street, suburb, state, postcode, website,
//   categories: string[], star_rating, review_count, years_in_business,
//   snippet, yp_url, image, is_ad }
// In practice street/suburb/state/postcode often come back null even when
// full_address/yp_url have the location, so we fall back to parsing the
// suburb-state out of the yp_url slug (e.g. "/south-penrith-nsw/...").
import { runApifyActor, readApifyDataset } from "@/lib/apify/client"
import type { DiscoveryRequest, NormalizedBusiness } from "../types"

const ACTOR_ID = "mamies/yellowpages-australia-scraper"

const AU_STATES = new Set(["nsw", "vic", "qld", "wa", "sa", "tas", "act", "nt"])

interface RawItem {
  name?: string
  phone?: string
  full_address?: string
  street?: string
  suburb?: string
  state?: string
  postcode?: string
  website?: string
  categories?: string[]
  star_rating?: number
  review_count?: number
  yp_url?: string
  [key: string]: unknown
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function parseLocationFromSlug(ypUrl?: string): { suburb?: string; state?: string } {
  if (!ypUrl) return {}
  try {
    const path = new URL(ypUrl).pathname
    const slug = path.split("/").filter(Boolean)[0]
    if (!slug) return {}
    const parts = slug.split("-")
    const last = parts[parts.length - 1]?.toLowerCase()
    if (!AU_STATES.has(last)) return {}
    const suburbWords = parts.slice(0, -1)
    const suburb = suburbWords.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ")
    return { suburb: suburb || undefined, state: last.toUpperCase() }
  } catch {
    return {}
  }
}

export async function searchYellowPagesAu(request: DiscoveryRequest): Promise<NormalizedBusiness[]> {
  const { datasetId } = await runApifyActor(ACTOR_ID, {
    searchTerm: request.categories.join(", "),
    location: request.location,
    maxResults: request.maxResults,
  })

  const items = (await readApifyDataset(datasetId)) as unknown as RawItem[]

  const results: NormalizedBusiness[] = []
  for (const item of items) {
    const name = str(item.name)
    if (!name) continue

    const fromSlug = parseLocationFromSlug(item.yp_url)

    results.push({
      source: "yellowpages_au",
      sourceUrl: item.yp_url,
      name,
      category: item.categories?.[0],
      phone: str(item.phone),
      website: str(item.website),
      street: str(item.street),
      suburb: str(item.suburb) || fromSlug.suburb,
      state: str(item.state) || fromSlug.state,
      postcode: str(item.postcode),
      country: "AU",
      rating: typeof item.star_rating === "number" ? item.star_rating : undefined,
      reviewCount: typeof item.review_count === "number" ? item.review_count : undefined,
      raw: item as Record<string, unknown>,
    })
  }
  return results
}
