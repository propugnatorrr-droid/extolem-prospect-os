import type {
  DiscoveryRequest,
  DiscoverySource,
  NormalizedBusiness,
} from "./types"
import { searchTomTom } from "./sources/tomtom"
import { searchGeoapify } from "./sources/geoapify"
import { searchOpenStreetMap } from "./sources/openstreetmap"

export function isDirectSource(
  source: DiscoverySource,
): source is
  | "tomtom_api"
  | "geoapify_api"
  | "openstreetmap" {
  return (
    source === "tomtom_api" ||
    source === "geoapify_api" ||
    source === "openstreetmap"
  )
}

export async function runDirectSource(
  source: DiscoverySource,
  request: DiscoveryRequest,
): Promise<NormalizedBusiness[]> {
  switch (source) {
    case "tomtom_api":
      return searchTomTom(request)

    case "geoapify_api":
      return searchGeoapify(request)

    case "openstreetmap":
      return searchOpenStreetMap(request)

    default:
      throw new Error(
        `Unsupported direct source: ${source}`,
      )
  }
}
