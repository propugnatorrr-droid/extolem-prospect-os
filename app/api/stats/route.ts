import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"

export const dynamic = "force-dynamic"

export async function GET() {
  const [businessCount, searchRunCount, opportunityCount, recentBusinesses, offerCounts] = await Promise.all([
    prisma.business.count(),
    prisma.searchRun.count(),
    prisma.opportunity.count(),
    prisma.business.findMany({ orderBy: { createdAt: "desc" }, take: 8, select: { id: true, name: true, suburb: true, category: true, createdAt: true } }),
    prisma.opportunity.groupBy({ by: ["offer"], _count: { offer: true }, orderBy: { _count: { offer: "desc" } }, take: 6 }),
  ])

  const auditedCount = await prisma.business.count({ where: { status: "reviewed" } })

  return NextResponse.json({
    businessCount,
    searchRunCount,
    opportunityCount,
    auditedCount,
    recentBusinesses,
    topOffers: offerCounts.map((o) => ({ offer: o.offer, count: o._count.offer })),
  })
}
