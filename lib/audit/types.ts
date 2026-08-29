export interface AuditFinding {
  name: string
  value: unknown
  source: string // e.g. "homepage-html", "pagespeed", "contact-page"
  confidence: number // 0-1
}

export interface SiteFetchResult {
  url: string
  finalUrl: string
  status: number | null
  ok: boolean
  html: string
  fetchedAt: string
}

export type OpportunityOffer =
  | "website_rebuild"
  | "website_optimisation"
  | "seo"
  | "ai_chatbot"
  | "ai_receptionist"
  | "missed_call_recovery"
  | "review_automation"
  | "online_booking"
  | "lead_followup_automation"
  | "erp_opportunity"

export interface OpportunityResult {
  offer: OpportunityOffer
  score: number // 0-100
  confidence: number // 0-1
  reasons: string[]
}
