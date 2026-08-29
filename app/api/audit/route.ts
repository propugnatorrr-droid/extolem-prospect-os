import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/db"
import { runWebsiteAudit } from "@/lib/audit/run"
import { scoreOpportunities } from "@/lib/opportunity/engine"
import { searchAbnByName, isAbnLookupConfigured } from "@/lib/abn/lookup"

// Site fetch + contact-page fetch + PageSpeed API can take 20-30s combined;
// Vercel's default is 10s, which would kill this mid-audit.
export const maxDuration = 60

const requestSchema = z.object({ businessId: z.string().min(1) })

export async function POST(request: Request) {
  const body = await request.json()
  const parsed = requestSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "businessId is required" }, { status: 400 })
  }

  const business = await prisma.business.findUnique({ where: { id: parsed.data.businessId } })
  if (!business) {
    return NextResponse.json({ error: "Business not found" }, { status: 404 })
  }

  let findings = [] as Awaited<ReturnType<typeof runWebsiteAudit>>["findings"]
  if (business.website) {
    const outcome = await runWebsiteAudit(business.id, business.website)
    findings = outcome.findings
  }

  const opportunities = scoreOpportunities(
    { hasWebsite: Boolean(business.website), rating: business.rating, reviewCount: business.reviewCount },
    findings,
  )

  // Replace previous opportunities for this business with the fresh scoring pass.
  await prisma.opportunity.deleteMany({ where: { businessId: business.id } })
  for (const opp of opportunities) {
    await prisma.opportunity.create({
      data: {
        businessId: business.id,
        offer: opp.offer,
        score: opp.score,
        confidence: opp.confidence,
        reasons: JSON.stringify(opp.reasons),
      },
    })
  }

  // Best-effort ABN validation. No-ops until ABR_GUID is configured; never
  // blocks or fails the audit if the lookup doesn't turn up a clean match.
  if (!business.abn && isAbnLookupConfigured()) {
    const matches = await searchAbnByName(business.name, business.postcode || undefined)
    const bestMatch = matches.find((m) => m.isCurrent && m.score >= 80)
    if (bestMatch) {
      await prisma.business.update({ where: { id: business.id }, data: { abn: bestMatch.abn } })
    }
  }

  return NextResponse.json({ opportunities })
}
