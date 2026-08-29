import { NextResponse } from "next/server"
import { getOperatorProfile } from "@/lib/operator/profile"
import { getCurrentWeather, weatherLabel } from "@/lib/operator/weather"

export const dynamic = "force-dynamic"

export async function GET() {
  const profile = await getOperatorProfile()

  let weather = null
  if (profile.homeLat != null && profile.homeLon != null) {
    const current = await getCurrentWeather(profile.homeLat, profile.homeLon)
    if (current) {
      weather = { ...current, label: weatherLabel(current.weatherCode) }
    }
  }

  const localTime = new Intl.DateTimeFormat("en-AU", {
    timeZone: profile.timezone,
    weekday: "long",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date())

  return NextResponse.json({ profile, weather, localTime })
}
