import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"

export const dynamic = "force-dynamic"

export async function GET() {
  const runs = await prisma.searchRun.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      id: true,
      query: true,
      categories: true,
      location: true,
      radiusKm: true,
      status: true,
      resultCount: true,
      createdAt: true,
      completedAt: true,
    },
  })
  return NextResponse.json({ runs })
}
