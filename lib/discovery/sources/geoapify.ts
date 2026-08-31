import type {
  DiscoveryRequest,
  NormalizedBusiness,
} from "../types"

const GEOCODE_URL =
  "https://api.geoapify.com/v1/geocode/search"

const PLACES_URL =
  "https://api.geoapify.com/v2/places"

const CATEGORY_MAP: Record<string, string[]> = {
  hotel: ["accommodation.hotel"],
  hotels: ["accommodation.hotel"],
  motel: ["accommodation.motel"],
  motels: ["accommodation.motel"],
  hostel: ["accommodation.hostel"],
  hostels: ["accommodation.hostel"],
  accommodation: ["accommodation"],

  clinic: ["healthcare.clinic_or_praxis"],
  clinics: ["healthcare.clinic_or_praxis"],
  doctor: ["healthcare.clinic_or_praxis.general"],
  doctors: ["healthcare.clinic_or_praxis.general"],
  surgeon: ["healthcare.clinic_or_praxis"],
  surgeons: ["healthcare.clinic_or_praxis"],
  dentist: ["healthcare.dentist"],
  dentists: ["healthcare.dentist"],
  hospital: ["healthcare.hospital"],
  hospitals: ["healthcare.hospital"],
  pharmacy: ["healthcare.pharmacy"],
  pharmacies: ["healthcare.pharmacy"],

  restaurant: ["catering.restaurant"],
  restaurants: ["catering.restaurant"],
  cafe: ["catering.cafe"],
  cafes: ["catering.cafe"],
  bar: ["catering.bar"],
  bars: ["catering.bar"],
  pub: ["catering.pub"],
  pubs: ["catering.pub"],
  bakery: ["commercial.food_and_drink.bakery"],
  bakeries: ["commercial.food_and_drink.bakery"],

  electrician: ["service.electrician"],
  electricians: ["service.electrician"],
  plumber: ["service.plumber"],
  plumbers: ["service.plumber"],
  cleaner: ["service.cleaning"],
  cleaners: ["service.cleaning"],
  cleaning: ["service.cleaning"],
  locksmith: ["service.locksmith"],
  locksmiths: ["service.locksmith"],
  carpenter: ["service.carpenter"],
  carpenters: ["service.carpenter"],
  hairdresser: ["service.beauty.hairdresser"],
  hairdressers: ["service.beauty.hairdresser"],

  accountant: ["office.accountant"],
  accountants: ["office.accountant"],
  lawyer: ["office.lawyer"],
  lawyers: ["office.lawyer"],
  solicitor: ["office.lawyer"],
  solicitors: ["office.lawyer"],
  architect: ["office.architect"],
  architects: ["office.architect"],
  consultant: ["office.consulting"],
  consultants: ["office.consulting"],
  "real estate": ["office.estate_agent"],
  "real estate agent": ["office.estate_agent"],
  "real estate agents": ["office.estate_agent"],

  supermarket: ["commercial.supermarket"],
  supermarkets: ["commercial.supermarket"],
  florist: ["commercial.florist"],
  florists: ["commercial.florist"],
  furniture: ["commercial.furniture_and_interior"],
  hardware: [
    "commercial.houseware_and_hardware.hardware_and_tools",
  ],
  mechanic: ["commercial.vehicle"],
  mechanics: ["commercial.vehicle"],
  "car repair": ["commercial.vehicle"],

  gym: ["sport.fitness"],
  gyms: ["sport.fitness"],
  spa: ["leisure.spa"],
  spas: ["leisure.spa"],
  veterinarian: ["pet.veterinary"],
  veterinarians: ["pet.veterinary"],
  vet: ["pet.veterinary"],
  vets: ["pet.veterinary"],
}

interface GeoFeature {
  properties?: Record<string, unknown>
  geometry?: {
    coordinates?: [number, number]
  }
}

interface GeoResponse {
  features?: GeoFeature[]
}

function stringValue(
  value: unknown,
): string | undefined {
  return typeof value === "string" && value.trim()
    ? value.trim()
    : undefined
}

function objectValue(
  value: unknown,
): Record<string, unknown> {
  return value &&
    typeof value === "object" &&
    !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function mappedCategories(
  categories: string[],
): string[] {
  const result = new Set<string>()

  for (const category of categories) {
    const normalized = category.trim().toLowerCase()
    const singular = normalized.replace(/s$/, "")

    const matches =
      CATEGORY_MAP[normalized] ||
      CATEGORY_MAP[singular] ||
      Object.entries(CATEGORY_MAP).find(([key]) =>
        normalized.includes(key),
      )?.[1]

    for (const match of matches || []) {
      result.add(match)
    }
  }

  return Array.from(result)
}

async function geocodeLocation(
  apiKey: string,
  location: string,
): Promise<{ lat: number; lon: number } | null> {
  const params = new URLSearchParams({
    text: location,
    filter: "countrycode:au",
    format: "geojson",
    limit: "1",
    apiKey,
  })

  const response = await fetch(
    `${GEOCODE_URL}?${params.toString()}`,
    {
      signal: AbortSignal.timeout(8_000),
      cache: "no-store",
    },
  )

  if (!response.ok) {
    throw new Error(
      `Geoapify geocoding returned HTTP ${response.status}`,
    )
  }

  const data = (await response.json()) as GeoResponse
  const feature = data.features?.[0]
  const coordinates = feature?.geometry?.coordinates

  if (!coordinates) return null

  return {
    lon: coordinates[0],
    lat: coordinates[1],
  }
}

function normalizeFeature(
  feature: GeoFeature,
): NormalizedBusiness | null {
  const properties = objectValue(feature.properties)
  const contact = objectValue(properties.contact)
  const datasource = objectValue(properties.datasource)
  const raw = objectValue(datasource.raw)

  const name =
    stringValue(properties.name) ||
    stringValue(properties.address_line1)

  if (!name) return null

  const coordinates = feature.geometry?.coordinates

  const categories = Array.isArray(properties.categories)
    ? properties.categories.filter(
        (value): value is string =>
          typeof value === "string",
      )
    : []

  return {
    source: "geoapify_api",
    sourceId: stringValue(properties.place_id),
    sourceUrl:
      stringValue(properties.website) ||
      stringValue(contact.website) ||
      stringValue(raw.website) ||
      stringValue(raw["contact:website"]),
    name,
    category: categories[0],
    phone:
      stringValue(properties.phone) ||
      stringValue(contact.phone) ||
      stringValue(raw.phone) ||
      stringValue(raw["contact:phone"]),
    email:
      stringValue(properties.email) ||
      stringValue(contact.email) ||
      stringValue(raw.email) ||
      stringValue(raw["contact:email"]),
    website:
      stringValue(properties.website) ||
      stringValue(contact.website) ||
      stringValue(raw.website) ||
      stringValue(raw["contact:website"]),
    street:
      stringValue(properties.address_line1) ||
      [
        stringValue(properties.housenumber),
        stringValue(properties.street),
      ]
        .filter(Boolean)
        .join(" ") ||
      undefined,
    suburb:
      stringValue(properties.suburb) ||
      stringValue(properties.city) ||
      stringValue(properties.county),
    state:
      stringValue(properties.state_code) ||
      stringValue(properties.state),
    postcode: stringValue(properties.postcode),
    country:
      stringValue(properties.country_code)?.toUpperCase() ||
      "AU",
    latitude:
      typeof properties.lat === "number"
        ? properties.lat
        : coordinates?.[1],
    longitude:
      typeof properties.lon === "number"
        ? properties.lon
        : coordinates?.[0],
    raw: properties,
  }
}

export async function searchGeoapify(
  request: DiscoveryRequest,
): Promise<NormalizedBusiness[]> {
  const apiKey = process.env.GEOAPIFY_API_KEY

  if (!apiKey) {
    throw new Error("GEOAPIFY_API_KEY is not configured")
  }

  const categories = mappedCategories(
    request.categories,
  )

  if (!categories.length) {
    return []
  }

  const centre = await geocodeLocation(
    apiKey,
    request.location,
  )

  if (!centre) {
    throw new Error(
      `Could not locate ${request.location}`,
    )
  }

  const params = new URLSearchParams({
    categories: categories.join(","),
    filter: `circle:${centre.lon},${centre.lat},${Math.round(
      request.radiusKm * 1000,
    )}`,
    bias: `proximity:${centre.lon},${centre.lat}`,
    limit: String(
      Math.min(Math.max(request.maxResults, 1), 100),
    ),
    lang: "en",
    apiKey,
  })

  const response = await fetch(
    `${PLACES_URL}?${params.toString()}`,
    {
      signal: AbortSignal.timeout(12_000),
      cache: "no-store",
    },
  )

  if (!response.ok) {
    throw new Error(
      `Geoapify Places returned HTTP ${response.status}`,
    )
  }

  const data = (await response.json()) as GeoResponse

  return (data.features || [])
    .map(normalizeFeature)
    .filter(
      (
        result,
      ): result is NormalizedBusiness => Boolean(result),
    )
    .slice(0, request.maxResults)
}
