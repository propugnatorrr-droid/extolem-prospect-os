// Free, real, no-API-key discovery source. Radius-based (unlike the demo
// text-parsing OpenStreetMap source under lib/sources/local) so it matches
// "35km around Penrith" style requests precisely.
import type { DiscoveryRequest, NormalizedBusiness } from "../types"
import { geocodeLocation, bboxAroundPoint } from "../geo"

const OVERPASS_URL = "https://overpass-api.de/api/interpreter"
const USER_AGENT = "ExtolemProspectOS/1.0 (internal prospecting tool)"

// Maps a spoken-language category to the OSM tag that actually carries it.
// OSM classifies businesses by tag/value, not by name text, so "plumber"
// must become office=plumber rather than a name-contains-"plumber" filter —
// most real plumbing businesses don't have the word "plumber" in their name.
const CATEGORY_TAG_MAP: Record<string, { tag: string; value: string }> = {
  plumber: { tag: "office", value: "plumber" },
  plumbers: { tag: "office", value: "plumber" },
  "emergency plumber": { tag: "office", value: "plumber" },
  electrician: { tag: "office", value: "electrician" },
  electricians: { tag: "office", value: "electrician" },
  dentist: { tag: "amenity", value: "dentist" },
  dentists: { tag: "amenity", value: "dentist" },
  doctor: { tag: "amenity", value: "doctors" },
  gp: { tag: "amenity", value: "doctors" },
  restaurant: { tag: "amenity", value: "restaurant" },
  cafe: { tag: "amenity", value: "cafe" },
  bar: { tag: "amenity", value: "bar" },
  pub: { tag: "amenity", value: "pub" },
  mechanic: { tag: "shop", value: "car_repair" },
  "car repair": { tag: "shop", value: "car_repair" },
  roofer: { tag: "craft", value: "roofer" },
  roofing: { tag: "craft", value: "roofer" },
  builder: { tag: "craft", value: "builder" },
  carpenter: { tag: "craft", value: "carpenter" },
  painter: { tag: "craft", value: "painter" },
  hvac: { tag: "craft", value: "hvac" },
  locksmith: { tag: "shop", value: "locksmith" },
  lawyer: { tag: "office", value: "lawyer" },
  accountant: { tag: "office", value: "accountant" },
  "real estate": { tag: "office", value: "estate_agent" },
  hairdresser: { tag: "shop", value: "hairdresser" },
  salon: { tag: "shop", value: "hairdresser" },
  gym: { tag: "leisure", value: "fitness_centre" },
  vet: { tag: "amenity", value: "veterinary" },
  veterinary: { tag: "amenity", value: "veterinary" },
  pharmacy: { tag: "amenity", value: "pharmacy" },
  bakery: { tag: "shop", value: "bakery" },
  cleaner: { tag: "office", value: "cleaning" },
  cleaning: { tag: "office", value: "cleaning" },
    hotel: { tag: "tourism", value: "hotel" },
  hotels: { tag: "tourism", value: "hotel" },
  motel: { tag: "tourism", value: "motel" },
  motels: { tag: "tourism", value: "motel" },
  accommodation: { tag: "tourism", value: "hotel" },
  resort: { tag: "tourism", value: "resort" },
  resorts: { tag: "tourism", value: "resort" },
  hostel: { tag: "tourism", value: "hostel" },
  hostels: { tag: "tourism", value: "hostel" },
}

function lookupCategoryTag(category: string): { tag: string; value: string } | null {
  const key = category.trim().toLowerCase()
  if (CATEGORY_TAG_MAP[key]) return CATEGORY_TAG_MAP[key]
  const singular = key.replace(/s$/, "")
  if (CATEGORY_TAG_MAP[singular]) return CATEGORY_TAG_MAP[singular]
  for (const [mapKey, val] of Object.entries(CATEGORY_TAG_MAP)) {
    if (key.includes(mapKey)) return val
  }
  return null
}

interface OverpassElement {
  type: "node" | "way" | "relation"
  id: number
  lat?: number
  lon?: number
  center?: { lat: number; lon: number }
  tags?: Record<string, string>
}

function buildQuery(categories: string[], bbox: string): string {
  const clauses: string[] = []
  const tagKeys = ["amenity", "shop", "office", "craft", "tourism", "leisure"]
  const cleanCategories = categories.map((c) => c.trim()).filter(Boolean)

  for (const category of cleanCategories) {
    const mapped = lookupCategoryTag(category)
    if (mapped) {
      // Known category: match the real OSM tag/value (e.g. office=plumber).
      clauses.push(`node["${mapped.tag}"="${mapped.value}"](${bbox});`, `way["${mapped.tag}"="${mapped.value}"](${bbox});`)
    } else {
      // Unknown category: fall back to a name-text search across common tag keys.
      const safe = category.replace(/["\\]/g, "")
      for (const key of tagKeys) {
        clauses.push(`node["${key}"]["name"~"${safe}",i](${bbox});`, `way["${key}"]["name"~"${safe}",i](${bbox});`)
      }
    }
  }

  if (clauses.length === 0) {
    for (const key of tagKeys) {
      clauses.push(`node["name"]["${key}"](${bbox});`, `way["name"]["${key}"](${bbox});`)
    }
  }

  return `[out:json][timeout:25];\n(\n${clauses.join("\n")}\n);\nout center body;`
}

function buildAddress(tags: Record<string, string>) {
  const street = tags["addr:street"]
  const houseNumber = tags["addr:housenumber"]
  return {
    street: street ? (houseNumber ? `${houseNumber} ${street}` : street) : undefined,
    suburb: tags["addr:suburb"] || tags["addr:city"],
    state: tags["addr:state"],
    postcode: tags["addr:postcode"],
  }
}

function categoryFromTags(tags: Record<string, string>): string {
  return tags.amenity || tags.shop || tags.office || tags.craft || tags.tourism || tags.leisure || "business"
}

export async function searchOpenStreetMap(request: DiscoveryRequest): Promise<NormalizedBusiness[]> {
  const geo = await geocodeLocation(request.location)
  if (!geo) return []

  const bbox = bboxAroundPoint(geo.lat, geo.lon, request.radiusKm)
  const query = buildQuery(request.categories, bbox)

  const res = await fetch(OVERPASS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": USER_AGENT,
    },
    body: `data=${encodeURIComponent(query)}`,
    signal: AbortSignal.timeout(12_000),
    cache: "no-store",
  })

  if (!res.ok) return []

  const data = (await res.json()) as { elements: OverpassElement[] }
  const seen = new Set<number>()
  const results: NormalizedBusiness[] = []

  for (const el of data.elements || []) {
    if (seen.has(el.id) || !el.tags?.name) continue
    seen.add(el.id)
    const tags = el.tags
    const address = buildAddress(tags)
    const lat = el.lat ?? el.center?.lat
    const lon = el.lon ?? el.center?.lon

    results.push({
      source: "openstreetmap",
      sourceId: `${el.type}/${el.id}`,
      sourceUrl: `https://www.openstreetmap.org/${el.type}/${el.id}`,
      name: tags.name,
      category: categoryFromTags(tags),
      phone: tags.phone || tags["contact:phone"],
      email: tags.email || tags["contact:email"],
      website: tags.website || tags["contact:website"],
      street: address.street,
      suburb: address.suburb,
      state: address.state,
      postcode: address.postcode,
      country: "AU",
      latitude: lat,
      longitude: lon,
      raw: { ...tags, osmId: el.id, osmType: el.type },
    })
  }

  return results.slice(0, request.maxResults)
}
