import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { getOperatorProfile, distanceFromHome } from "@/lib/operator/profile"

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const business = await prisma.business.findUnique({
    where: { id: params.id },
    include: { sources: true, contacts: true, opportunities: true, audits: true },
  })
  if (!business) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const profile = await getOperatorProfile()
  const distanceFromHomeKm = distanceFromHome(profile, business.latitude, business.longitude)

  return NextResponse.json({ business: { ...business, distanceFromHomeKm } })
}
