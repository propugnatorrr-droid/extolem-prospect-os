// Apify Google Search Scraper (apify/google-search-scraper).
// Unlike the other sources this doesn't return clean structured business
// records — it finds candidate web pages (official sites, directory
// listings, Facebook pages). We surface these as low-confidence leads for
// manual review / merge, not as verified businesses.
import { runApifyActor, readApifyDataset } from "@/lib/apify/client"
import type { DiscoveryRequest, NormalizedBusiness } from "../types"

const ACTOR_ID = "apify/google-search-scraper"

interface OrganicResult {
  title?: string
  url?: string
  description?: string
}

interface SearchResultItem {
  searchQuery?: { term?: string }
  organicResults?: OrganicResult[]
}

export async function searchGoogleApify(request: DiscoveryRequest): Promise<NormalizedBusiness[]> {
  const queries = request.categories.flatMap((category) => [
    `"${category}" "${request.location}" contact`,
    `"${category}" "${request.location}" book online`,
  ])

  const { datasetId } = await runApifyActor(ACTOR_ID, {
    queries: queries.join("\n"),
    countryCode: "au",
    languageCode: "en",
    maxPagesPerQuery: 1,
    resultsPerPage: 10,
    mobileResults: false,
  })

  const items = (await readApifyDataset(datasetId)) as unknown as SearchResultItem[]
  const results: NormalizedBusiness[] = []

  for (const item of items) {
    for (const organic of item.organicResults || []) {
      if (!organic.title || !organic.url) continue
      results.push({
        source: "google_search_apify",
        sourceUrl: organic.url,
        name: organic.title,
        website: organic.url,
        country: "AU",
        raw: { ...organic, query: item.searchQuery?.term },
      })
    }
  }

  return results.slice(0, request.maxResults)
}
