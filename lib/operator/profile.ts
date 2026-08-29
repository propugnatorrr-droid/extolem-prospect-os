import { geocodeLocation, haversineKm } from "@/lib/discovery/geo"

export interface OperatorProfile {
  firstName: string
  lastName: string
  fullName: string
  homeLocation: string
  timezone: string
  homeLat: number | null
  homeLon: number | null
}

let cached: OperatorProfile | null = null

export function getOperatorStatic(): Omit<OperatorProfile, "homeLat" | "homeLon"> {
  const firstName = process.env.OPERATOR_FIRST_NAME || ""
  const lastName = process.env.OPERATOR_LAST_NAME || ""
  return {
    firstName,
    lastName,
    fullName: [firstName, lastName].filter(Boolean).join(" "),
    homeLocation: process.env.OPERATOR_HOME_LOCATION || "",
    timezone: process.env.OPERATOR_TIMEZONE || "Australia/Sydney",
  }
}

/** Resolves the operator's home location to coordinates once and caches it in-process. */
export async function getOperatorProfile(): Promise<OperatorProfile> {
  if (cached) return cached
  const base = getOperatorStatic()
  let homeLat: number | null = null
  let homeLon: number | null = null

  if (base.homeLocation) {
    const geo = await geocodeLocation(base.homeLocation)
    if (geo) {
      homeLat = geo.lat
      homeLon = geo.lon
    }
  }

  cached = { ...base, homeLat, homeLon }
  return cached
}

export function distanceFromHome(
  profile: OperatorProfile,
  lat?: number | null,
  lon?: number | null,
): number | null {
  if (profile.homeLat == null || profile.homeLon == null || lat == null || lon == null) return null
  return Math.round(haversineKm(profile.homeLat, profile.homeLon, lat, lon) * 10) / 10
}
