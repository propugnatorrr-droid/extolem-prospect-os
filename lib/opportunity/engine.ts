import type { AuditFinding, OpportunityResult } from "@/lib/audit/types"
import type { ConversionChecks } from "@/lib/audit/conversionChecks"
import type { DetectedTech } from "@/lib/audit/techDetector"

interface BusinessSignal {
  hasWebsite: boolean
  rating: number | null
  reviewCount: number | null
}

function findingValue<T>(findings: AuditFinding[], name: string): T | undefined {
  return findings.find((f) => f.name === name)?.value as T | undefined
}

/**
 * Deterministic opportunity scoring — every rule here maps to a concrete,
 * checkable fact (a finding), never a guess. Confidence stays conservative
 * (<=0.6) for anything inferred rather than directly observed.
 */
export function scoreOpportunities(business: BusinessSignal, findings: AuditFinding[]): OpportunityResult[] {
  const results: OpportunityResult[] = []

  if (!business.hasWebsite) {
    results.push({
      offer: "website_rebuild",
      score: 95,
      confidence: 0.9,
      reasons: ["No website found for this business across any discovery source"],
    })
    // Without a website most downstream checks (chat, booking, SEO) don't apply —
    // but phone/receptionist opportunities still do, so fall through.
  } else {
    const pagespeed = findingValue<{ performanceScore: number | null; seoScore: number | null; isMobileFriendly: boolean | null }>(
      findings,
      "pagespeed",
    )
    const checks = findingValue<ConversionChecks>(findings, "conversion_checks")
    const reachable = findingValue<boolean>(findings, "site_reachable")

    if (reachable === false) {
      results.push({
        offer: "website_rebuild",
        score: 90,
        confidence: 0.85,
        reasons: ["Listed website did not load (dead link, expired domain, or broken hosting)"],
      })
    } else {
      const perfReasons: string[] = []
      if (pagespeed?.performanceScore != null && pagespeed.performanceScore < 50) {
        perfReasons.push(`PageSpeed performance score is ${pagespeed.performanceScore}/100 on mobile`)
      }
      if (checks && !checks.hasMobileViewport) perfReasons.push("No mobile viewport tag, site isn't optimised for phones")
      if (pagespeed?.isMobileFriendly === false) perfReasons.push("PageSpeed flags the site as not mobile-friendly")
      if (perfReasons.length) {
        results.push({ offer: "website_optimisation", score: 70, confidence: 0.75, reasons: perfReasons })
      }

      const seoReasons: string[] = []
      if (checks && checks.titleLength === 0) seoReasons.push("Missing page title")
      if (checks && checks.metaDescriptionLength === 0) seoReasons.push("Missing meta description")
      if (checks && !checks.hasH1) seoReasons.push("No H1 heading found")
      if (checks && !checks.hasSchemaOrg) seoReasons.push("No structured data (schema.org) on the page")
      if (pagespeed?.seoScore != null && pagespeed.seoScore < 70) seoReasons.push(`PageSpeed SEO score is ${pagespeed.seoScore}/100`)
      if (seoReasons.length >= 2) {
        results.push({ offer: "seo", score: 60, confidence: 0.7, reasons: seoReasons })
      }

      if (checks && !checks.hasOnlineBooking) {
        results.push({
          offer: "online_booking",
          score: 55,
          confidence: 0.6,
          reasons: ["No online booking or quote-request flow detected on the site"],
        })
      }

      if (checks && !checks.hasContactForm && checks.hasClickToCall) {
        results.push({
          offer: "lead_followup_automation",
          score: 50,
          confidence: 0.5,
          reasons: ["No contact form, phone is the only lead channel and it's easy to lose after-hours enquiries"],
        })
      }
    }

    const tech = findingValue<DetectedTech[]>(findings, "technology_detected") || []
    const hasChat = tech.some((t) => t.category === "chat")
    if (!hasChat) {
      results.push({
        offer: "ai_chatbot",
        score: 65,
        confidence: 0.6,
        reasons: ["No chat widget or chatbot detected on the site"],
      })
    }
  }

  // Phone-led business signals — apply regardless of website state.
  const checks = findingValue<ConversionChecks>(findings, "conversion_checks")
  if (!business.hasWebsite || (checks && !checks.hasClickToCall)) {
    results.push({
      offer: "ai_receptionist",
      score: 75,
      confidence: 0.55,
      reasons: [
        business.hasWebsite
          ? "No click-to-call link on the website, calls likely go through a receptionist or voicemail with no digital backup"
          : "No website at all, phone is the only contact channel and missed calls have no fallback",
      ],
    })
  }

  if (business.reviewCount != null && business.reviewCount > 0 && business.reviewCount < 15) {
    results.push({
      offer: "review_automation",
      score: 40,
      confidence: 0.4,
      reasons: [`Only ${business.reviewCount} reviews found, a review-request flow after each job would help`],
    })
  }
  if (business.rating != null && business.rating < 4.3 && business.reviewCount != null && business.reviewCount >= 5) {
    results.push({
      offer: "review_automation",
      score: 55,
      confidence: 0.5,
      reasons: [`Rating is ${business.rating}/5 across ${business.reviewCount} reviews, worth checking recent complaints before the call`],
    })
  }

  return results.sort((a, b) => b.score - a.score)
}
