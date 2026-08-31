import type { DiscoverySource, NormalizedBusiness } from "./types"

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim()
    ? value.trim()
    : undefined
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value)

    if (Number.isFinite(parsed)) {
      return parsed
    }
  }

  return undefined
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function parseYellowPagesLocation(url?: string): {
  suburb?: string
  state?: string
} {
  if (!url) return {}

  try {
    const pathname = new URL(url).pathname
    const slug = pathname.split("/").filter(Boolean)[0]

    if (!slug) return {}

    const parts = slug.split("-")
    const state = parts.at(-1)?.toUpperCase()

    if (!state || !["NSW", "VIC", "QLD", "WA", "SA", "TAS", "ACT", "NT"].includes(state)) {
      return {}
    }

    const suburb = parts
      .slice(0, -1)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ")

    return {
      suburb: suburb || undefined,
      state,
    }
  } catch {
    return {}
  }
}

function normalizeGoogleMaps(
  items: Record<string, unknown>[],
): NormalizedBusiness[] {
  return items.flatMap((item) => {
    const name = stringValue(item.title)
    if (!name) return []

    const location = objectValue(item.location)

    return [
      {
        source: "google_maps_apify" as const,
        sourceId: stringValue(item.placeId),
        sourceUrl: stringValue(item.url),
        name,
        category: stringValue(item.categoryName),
        phone:
          stringValue(item.phoneUnformatted) ||
          stringValue(item.phone),
        website: stringValue(item.website),
        street: stringValue(item.street),
        suburb: stringValue(item.city),
        state: stringValue(item.state),
        postcode: stringValue(item.postalCode),
        country: stringValue(item.countryCode)?.toUpperCase() || "AU",
        latitude: numberValue(location.lat),
        longitude: numberValue(location.lng),
        rating: numberValue(item.totalScore),
        reviewCount: numberValue(item.reviewsCount),
        raw: item,
      },
    ]
  })
}

function normalizeYellowPages(
  items: Record<string, unknown>[],
): NormalizedBusiness[] {
  return items.flatMap((item) => {
    const name = stringValue(item.name)
    if (!name) return []

    const sourceUrl = stringValue(item.yp_url)
    const parsedLocation = parseYellowPagesLocation(sourceUrl)
    const categories = Array.isArray(item.categories)
      ? item.categories.filter(
          (value): value is string => typeof value === "string",
        )
      : []

    return [
      {
        source: "yellowpages_au" as const,
        sourceId: sourceUrl,
        sourceUrl,
        name,
        category: categories[0],
        phone: stringValue(item.phone),
        email: stringValue(item.email),
        website: stringValue(item.website),
        street: stringValue(item.street),
        suburb: stringValue(item.suburb) || parsedLocation.suburb,
        state: stringValue(item.state) || parsedLocation.state,
        postcode: stringValue(item.postcode),
        country: "AU",
        rating: numberValue(item.star_rating),
        reviewCount: numberValue(item.review_count),
        raw: item,
      },
    ]
  })
}

function normalizeGoogleSearch(
  items: Record<string, unknown>[],
): NormalizedBusiness[] {
  const records: NormalizedBusiness[] = []

  for (const item of items) {
    const searchQuery = objectValue(item.searchQuery)
    const organicResults = Array.isArray(item.organicResults)
      ? item.organicResults
      : []

    for (const rawResult of organicResults) {
      const result = objectValue(rawResult)
      const name = stringValue(result.title)
      const website = stringValue(result.url)

      if (!name || !website) continue

      records.push({
        source: "google_search_apify",
        sourceId: website,
        sourceUrl: website,
        name,
        website,
        country: "AU",
        raw: {
          ...result,
          query: stringValue(searchQuery.term),
        },
      })
    }
  }

  return records
}

export function normalizeApifyItems(
  source: DiscoverySource,
  items: Record<string, unknown>[],
): NormalizedBusiness[] {
  switch (source) {
    case "google_maps_apify":
      return normalizeGoogleMaps(items)

    case "yellowpages_au":
      return normalizeYellowPages(items)

    case "google_search_apify":
      return normalizeGoogleSearch(items)

    default:
      return []
  }
}
