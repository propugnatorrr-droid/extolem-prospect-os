export type DiscoverySource =
  | "google_places_api"
  | "google_maps_apify"
  | "yellowpages_au"
  | "google_search_apify"
  | "openstreetmap"

export interface DiscoveryRequest {
  categories: string[]
  location: string
  radiusKm: number
  maxResults: number
  minimumRating?: number
  minimumReviews?: number
  requirePhone?: boolean
  requireWebsite?: boolean
  sources: DiscoverySource[]
}

export interface NormalizedBusiness {
  source: DiscoverySource
  sourceId?: string
  sourceUrl?: string
  name: string
  category?: string
  phone?: string
  email?: string
  website?: string
  street?: string
  suburb?: string
  state?: string
  postcode?: string
  country: string
  latitude?: number
  longitude?: number
  rating?: number
  reviewCount?: number
  raw: Record<string, unknown>
}
