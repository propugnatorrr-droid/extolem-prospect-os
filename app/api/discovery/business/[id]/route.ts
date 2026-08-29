import { NextResponse } from "next/server"
import { z } from "zod"
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

const patchSchema = z.object({
  status: z
    .enum(["new", "saved", "contacted", "qualified", "not_interested", "do_not_contact"])
    .optional(),
  notes: z.string().max(5000).optional(),
})

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const body = await request.json().catch(() => null)
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success || (!parsed.data.status && parsed.data.notes === undefined)) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 })
  }

  try {
    const business = await prisma.business.update({
      where: { id: params.id },
      data: parsed.data,
    })
    return NextResponse.json({ business })
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }
}
