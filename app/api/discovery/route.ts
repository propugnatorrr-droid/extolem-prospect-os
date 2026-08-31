import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import {
  distanceFromHome,
  getOperatorProfile,
} from "@/lib/operator/profile"

export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  const url = new URL(request.url)
  const searchRunId =
    url.searchParams.get("searchRunId") || undefined
  const status = url.searchParams.get("status") || undefined

  const profile = await getOperatorProfile()

  if (searchRunId) {
    const links = await prisma.searchRunBusiness.findMany({
      where: { searchRunId },
      include: {
        business: {
          include: {
            sources: true,
            contacts: true,
            opportunities: true,
            audits: {
              orderBy: { createdAt: "desc" },
              take: 1,
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 500,
    })

    const businesses = links
      .map((link) => link.business)
      .filter((business) =>
        status ? business.status === status : true,
      )
      .map((business) => ({
        ...business,
        distanceFromHomeKm: distanceFromHome(
          profile,
          business.latitude,
          business.longitude,
        ),
      }))
      .sort(
        (a, b) =>
          (a.distanceFromHomeKm ?? Infinity) -
          (b.distanceFromHomeKm ?? Infinity),
      )

    return NextResponse.json({ businesses })
  }

  const businesses = await prisma.business.findMany({
    where: status ? { status } : undefined,
    include: {
      sources: true,
      contacts: true,
      opportunities: true,
      audits: {
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
    orderBy: { createdAt: "desc" },
    take: 500,
  })

  return NextResponse.json({
    businesses: businesses
      .map((business) => ({
        ...business,
        distanceFromHomeKm: distanceFromHome(
          profile,
          business.latitude,
          business.longitude,
        ),
      }))
      .sort(
        (a, b) =>
          (a.distanceFromHomeKm ?? Infinity) -
          (b.distanceFromHomeKm ?? Infinity),
      ),
  })
}
