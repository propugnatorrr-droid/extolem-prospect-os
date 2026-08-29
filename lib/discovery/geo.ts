const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
const USER_AGENT = "ExtolemProspectOS/1.0 (internal prospecting tool)"

export interface GeoPoint {
  lat: number
  lon: number
  displayName: string
}

/** Free geocoding via OSM Nominatim. No API key required. */
export async function geocodeLocation(location: string): Promise<GeoPoint | null> {
  const url = `${NOMINATIM_URL}?q=${encodeURIComponent(location)}&format=json&limit=1&countrycodes=au`
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } })
  if (!res.ok) return null
  const results = (await res.json()) as Array<{ lat: string; lon: string; display_name: string }>
  if (!results.length) return null
  return { lat: parseFloat(results[0].lat), lon: parseFloat(results[0].lon), displayName: results[0].display_name }
}

/** Bounding box "south,west,north,east" around a point for a given radius in km. */
export function bboxAroundPoint(lat: number, lon: number, radiusKm: number): string {
  const latDelta = radiusKm / 111
  const lonDelta = radiusKm / (111 * Math.cos((lat * Math.PI) / 180))
  const south = lat - latDelta
  const north = lat + latDelta
  const west = lon - lonDelta
  const east = lon + lonDelta
  return `${south},${west},${north},${east}`
}

export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLon = ((lon2 - lon1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2
  return R * 2 * Math.asin(Math.sqrt(a))
}
