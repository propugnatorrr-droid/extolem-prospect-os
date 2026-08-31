import type {
  DiscoveryRequest,
  NormalizedBusiness,
} from "../types"

const TOMTOM_SEARCH_URL =
  "https://api.tomtom.com/search/2/search"

interface TomTomClassificationName {
  name?: string
}

interface TomTomClassification {
  names?: TomTomClassificationName[]
}

interface TomTomPoi {
  name?: string
  phone?: string
  url?: string
  categories?: string[]
  classifications?: TomTomClassification[]
}

interface TomTomAddress {
  streetNumber?: string
  streetName?: string
  municipalitySubdivision?: string
  municipality?: string
  countrySubdivision?: string
  postalCode?: string
  countryCode?: string
  freeformAddress?: string
}

interface TomTomResult {
  id?: string
  type?: string
  score?: number
  dist?: number
  poi?: TomTomPoi
  address?: TomTomAddress
  position?: {
    lat?: number
    lon?: number
  }
}

interface TomTomResponse {
  results?: TomTomResult[]
  error?: string
  detailedError?: {
    message?: string
  }
}

function categoryName(
  poi: TomTomPoi | undefined,
): string | undefined {
  return (
    poi?.classifications?.[0]?.names?.[0]?.name ||
    poi?.categories?.[0]
  )
}

function streetAddress(
  address: TomTomAddress | undefined,
): string | undefined {
  if (!address) return undefined

  const street = [
    address.streetNumber,
    address.streetName,
  ]
    .filter(Boolean)
    .join(" ")
    .trim()

  return street || address.freeformAddress
}

function normalizeResult(
  result: TomTomResult,
): NormalizedBusiness | null {
  if (
    result.type !== "POI" ||
    !result.poi?.name?.trim()
  ) {
    return null
  }

  return {
    source: "tomtom_api",
    sourceId: result.id,
    sourceUrl: result.poi.url,
    name: result.poi.name.trim(),
    category: categoryName(result.poi),
    phone: result.poi.phone,
    website: result.poi.url,
    street: streetAddress(result.address),
    suburb:
      result.address?.municipalitySubdivision ||
      result.address?.municipality,
    state: result.address?.countrySubdivision,
    postcode: result.address?.postalCode,
    country:
      result.address?.countryCode?.toUpperCase() || "AU",
    latitude: result.position?.lat,
    longitude: result.position?.lon,
    raw: result as unknown as Record<string, unknown>,
  }
}

async function searchCategory(
  category: string,
  request: DiscoveryRequest,
): Promise<NormalizedBusiness[]> {
  const apiKey = process.env.TOMTOM_API_KEY

  if (!apiKey) {
    throw new Error("TOMTOM_API_KEY is not configured")
  }

  const query = `${category} near ${request.location}`

  const params = new URLSearchParams({
    key: apiKey,
    countrySet: "AU",
    language: "en-AU",
    idxSet: "POI",
    typeahead: "false",
    limit: String(
      Math.min(Math.max(request.maxResults, 1), 100),
    ),
  })

  const response = await fetch(
    `${TOMTOM_SEARCH_URL}/${encodeURIComponent(
      query,
    )}.json?${params.toString()}`,
    {
      signal: AbortSignal.timeout(12_000),
      cache: "no-store",
    },
  )

  const data =
    (await response.json().catch(() => ({}))) as
      TomTomResponse

  if (!response.ok) {
    throw new Error(
      data.detailedError?.message ||
        data.error ||
        `TomTom returned HTTP ${response.status}`,
    )
  }

  return (data.results || [])
    .map(normalizeResult)
    .filter(
      (
        result,
      ): result is NormalizedBusiness => Boolean(result),
    )
}

export async function searchTomTom(
  request: DiscoveryRequest,
): Promise<NormalizedBusiness[]> {
  const records = new Map<string, NormalizedBusiness>()

  const results = await Promise.allSettled(
    request.categories.map((category) =>
      searchCategory(category, request),
    ),
  )

  for (const result of results) {
    if (result.status !== "fulfilled") continue

    for (const business of result.value) {
      const key =
        business.sourceId ||
        business.phone ||
        business.website ||
        `${business.name}:${business.postcode || ""}`

      if (!records.has(key)) {
        records.set(key, business)
      }
    }
  }

  return Array.from(records.values()).slice(
    0,
    request.maxResults,
  )
}
