import { startApifyActor } from "@/lib/apify/client"
import type { DiscoveryRequest, DiscoverySource } from "./types"

const ACTORS: Partial<Record<DiscoverySource, string>> = {
  google_maps_apify: "compass/crawler-google-places",
  yellowpages_au: "mamies/yellowpages-australia-scraper",
  google_search_apify: "apify/google-search-scraper",
}

export function isApifySource(
  source: DiscoverySource,
): source is
  | "google_maps_apify"
  | "yellowpages_au"
  | "google_search_apify" {
  return Boolean(ACTORS[source])
}

function buildInput(
  source: DiscoverySource,
  request: DiscoveryRequest,
): Record<string, unknown> {
  switch (source) {
    case "google_maps_apify":
      return {
        searchStringsArray: request.categories,
        locationQuery: request.location,
        maxCrawledPlacesPerSearch: Math.min(request.maxResults, 100),
        language: "en",
        countryCode: "au",
        scrapePlaceDetailPage: true,
        scrapeReviewsPersonalData: false,
        scrapeContacts: false,
        skipClosedPlaces: true,
      }

    case "yellowpages_au":
      return {
        searchTerm: request.categories.join(", "),
        location: request.location,
        maxResults: Math.min(request.maxResults, 200),
      }

    case "google_search_apify":
      return {
        queries: request.categories
          .flatMap((category) => [
            `"${category}" "${request.location}" contact`,
            `"${category}" "${request.location}" official website`,
          ])
          .join("\n"),
        countryCode: "au",
        languageCode: "en",
        maxPagesPerQuery: 1,
        resultsPerPage: 10,
        mobileResults: false,
      }

    default:
      throw new Error(`Unsupported Apify source: ${source}`)
  }
}

export async function startDiscoveryActor(
  source: DiscoverySource,
  request: DiscoveryRequest,
) {
  const actorId = ACTORS[source]

  if (!actorId) {
    throw new Error(`No actor configured for ${source}`)
  }

  return startApifyActor(actorId, buildInput(source, request))
}
