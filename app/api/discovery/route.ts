import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { getOperatorProfile, distanceFromHome } from "@/lib/operator/profile"

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const searchRunId = searchParams.get("searchRunId") || undefined
  const status = searchParams.get("status") || undefined

  const businesses = await prisma.business.findMany({
    where: { searchRunId, status },
    include: { sources: true, contacts: true, opportunities: true },
    orderBy: { createdAt: "desc" },
    take: 500,
  })

  const profile = await getOperatorProfile()
  const withDistance = businesses
    .map((b) => ({ ...b, distanceFromHomeKm: distanceFromHome(profile, b.latitude, b.longitude) }))
    .sort((a, b) => (a.distanceFromHomeKm ?? Infinity) - (b.distanceFromHomeKm ?? Infinity))

  return NextResponse.json({ businesses: withDistance })
}
