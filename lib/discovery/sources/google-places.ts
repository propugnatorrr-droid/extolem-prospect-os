import type {
  DiscoveryRequest,
  NormalizedBusiness,
} from "../types"

const GOOGLE_PLACES_URL =
  "https://places.googleapis.com/v1/places:searchText"

const FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.primaryTypeDisplayName",
  "places.formattedAddress",
  "places.addressComponents",
  "places.location",
  "places.nationalPhoneNumber",
  "places.internationalPhoneNumber",
  "places.websiteUri",
  "places.rating",
  "places.userRatingCount",
  "places.googleMapsUri",
  "places.businessStatus",
  "nextPageToken",
].join(",")

interface GoogleText {
  text?: string
}

interface GoogleAddressComponent {
  longText?: string
  shortText?: string
  types?: string[]
}

interface GooglePlace {
  id?: string
  displayName?: GoogleText
  primaryTypeDisplayName?: GoogleText
  formattedAddress?: string
  addressComponents?: GoogleAddressComponent[]
  location?: {
    latitude?: number
    longitude?: number
  }
  nationalPhoneNumber?: string
  internationalPhoneNumber?: string
  websiteUri?: string
  rating?: number
  userRatingCount?: number
  googleMapsUri?: string
  businessStatus?: string
}

interface GooglePlacesResponse {
  places?: GooglePlace[]
  nextPageToken?: string
  error?: {
    code?: number
    message?: string
    status?: string
  }
}

function addressPart(
  components: GoogleAddressComponent[] | undefined,
  type: string,
  short = false,
): string | undefined {
  const component = components?.find((item) =>
    item.types?.includes(type),
  )

  return short
    ? component?.shortText
    : component?.longText
}

function normalizePlace(
  place: GooglePlace,
): NormalizedBusiness | null {
  const name = place.displayName?.text?.trim()
  if (!name) return null

  const streetNumber = addressPart(
    place.addressComponents,
    "street_number",
  )

  const route = addressPart(
    place.addressComponents,
    "route",
  )

  const street = [streetNumber, route]
    .filter(Boolean)
    .join(" ")
    .trim()

  const suburb =
    addressPart(place.addressComponents, "locality") ||
    addressPart(place.addressComponents, "postal_town") ||
    addressPart(
      place.addressComponents,
      "sublocality_level_1",
    )

  return {
    source: "google_places_api",
    sourceId: place.id,
    sourceUrl: place.googleMapsUri,
    name,
    category:
      place.primaryTypeDisplayName?.text || undefined,
    phone:
      place.nationalPhoneNumber ||
      place.internationalPhoneNumber,
    website: place.websiteUri,
    street: street || place.formattedAddress,
    suburb,
    state: addressPart(
      place.addressComponents,
      "administrative_area_level_1",
      true,
    ),
    postcode: addressPart(
      place.addressComponents,
      "postal_code",
    ),
    country:
      addressPart(
        place.addressComponents,
        "country",
        true,
      ) || "AU",
    latitude: place.location?.latitude,
    longitude: place.location?.longitude,
    rating: place.rating,
    reviewCount: place.userRatingCount,
    raw: place as unknown as Record<string, unknown>,
  }
}

async function requestPage(
  apiKey: string,
  textQuery: string,
  pageSize: number,
  minimumRating?: number,
  pageToken?: string,
): Promise<GooglePlacesResponse> {
  const body: Record<string, unknown> = {
    textQuery,
    pageSize,
    languageCode: "en",
    regionCode: "AU",
    includePureServiceAreaBusinesses: true,
  }

  if (pageToken) {
    body.pageToken = pageToken
  }

  if (
    typeof minimumRating === "number" &&
    minimumRating > 0
  ) {
    body.minRating =
      Math.ceil(minimumRating * 2) / 2
  }

  const response = await fetch(GOOGLE_PLACES_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": FIELD_MASK,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  })

  const data =
    (await response.json().catch(() => ({}))) as
      GooglePlacesResponse

  if (!response.ok) {
    throw new Error(
      data.error?.message ||
        `Google Places returned HTTP ${response.status}`,
    )
  }

  return data
}

export async function searchGooglePlaces(
  request: DiscoveryRequest,
): Promise<NormalizedBusiness[]> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY

  if (!apiKey) {
    throw new Error(
      "GOOGLE_PLACES_API_KEY is not configured",
    )
  }

  const results = new Map<string, NormalizedBusiness>()
  const categories = request.categories
    .map((category) => category.trim())
    .filter(Boolean)

  const perCategoryTarget = Math.max(
    1,
    Math.ceil(request.maxResults / categories.length),
  )

  for (const category of categories) {
    let pageToken: string | undefined
    let categoryCount = 0
    let page = 0

    do {
      const remaining =
        perCategoryTarget - categoryCount

      const response = await requestPage(
        apiKey,
        `${category} in ${request.location}`,
        Math.min(20, Math.max(1, remaining)),
        request.minimumRating,
        pageToken,
      )

      for (const place of response.places || []) {
        const normalized = normalizePlace(place)
        if (!normalized) continue

        const key =
          normalized.sourceId ||
          normalized.phone ||
          normalized.website ||
          normalized.name.toLowerCase()

        if (!results.has(key)) {
          results.set(key, normalized)
          categoryCount += 1
        }

        if (
          results.size >= request.maxResults ||
          categoryCount >= perCategoryTarget
        ) {
          break
        }
      }

      pageToken = response.nextPageToken
      page += 1
    } while (
      pageToken &&
      page < 3 &&
      results.size < request.maxResults &&
      categoryCount < perCategoryTarget
    )

    if (results.size >= request.maxResults) {
      break
    }
  }

  return Array.from(results.values()).slice(
    0,
    request.maxResults,
  )
}
