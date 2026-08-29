import { prisma } from "@/lib/db"
import { fetchSiteWithContactPage } from "./fetchSite"
import { extractContacts } from "./contactExtractor"
import { detectTech } from "./techDetector"
import { runConversionChecks } from "./conversionChecks"
import { runPageSpeed } from "./pagespeed"
import type { AuditFinding } from "./types"

export interface AuditOutcome {
  websiteAuditId: string
  score: number | null
  findings: AuditFinding[]
  contacts: ReturnType<typeof extractContacts>
}

/** Runs a full website audit for a business and persists it + any newly found contacts. */
export async function runWebsiteAudit(businessId: string, website: string): Promise<AuditOutcome> {
  const { homepage, contactPage } = await fetchSiteWithContactPage(website)
  const findings: AuditFinding[] = []

  findings.push({ name: "site_reachable", value: homepage.ok, source: "fetch", confidence: 1 })
  findings.push({ name: "http_status", value: homepage.status, source: "fetch", confidence: 1 })
  findings.push({ name: "uses_https", value: homepage.finalUrl.startsWith("https://"), source: "fetch", confidence: 1 })

  if (!homepage.ok) {
    const audit = await prisma.websiteAudit.create({
      data: { businessId, url: website, findings: JSON.stringify(findings), score: null },
    })
    return { websiteAuditId: audit.id, score: null, findings, contacts: extractContacts("") }
  }

  const contacts = extractContacts(homepage.html, contactPage?.html || "")
  const tech = detectTech(homepage.html + (contactPage?.html || ""))
  const hasChatTech = tech.some((t) => t.category === "chat")
  const checks = runConversionChecks(
    homepage.html,
    homepage.finalUrl,
    contacts.hasContactForm,
    Boolean(contacts.bookingUrl),
    hasChatTech,
  )
  const pagespeed = await runPageSpeed(homepage.finalUrl)

  findings.push(
    { name: "phones_found", value: contacts.phones, source: "homepage-html", confidence: 0.8 },
    { name: "emails_found", value: contacts.emails, source: "homepage-html", confidence: 0.8 },
    { name: "facebook", value: contacts.facebook, source: "homepage-html", confidence: 0.7 },
    { name: "instagram", value: contacts.instagram, source: "homepage-html", confidence: 0.7 },
    { name: "booking_url", value: contacts.bookingUrl, source: "homepage-html", confidence: 0.7 },
    { name: "technology_detected", value: tech, source: "homepage-html", confidence: 0.85 },
    { name: "conversion_checks", value: checks, source: "homepage-html", confidence: 0.75 },
  )

  if (pagespeed) {
    findings.push({ name: "pagespeed", value: pagespeed, source: "pagespeed-api", confidence: 0.9 })
  }

  const audit = await prisma.websiteAudit.create({
    data: {
      businessId,
      url: homepage.finalUrl,
      findings: JSON.stringify(findings),
      score: pagespeed?.performanceScore ?? null,
    },
  })

  // Persist any newly discovered contact channels (dedup by type+value at the app level)
  const existing = await prisma.contact.findMany({ where: { businessId } })
  const existingValues = new Set(existing.map((c) => `${c.type}:${c.value}`))
  const newContacts: Array<{ type: string; value: string }> = []
  for (const phone of contacts.phones) newContacts.push({ type: "phone", value: phone })
  for (const email of contacts.emails) newContacts.push({ type: "email", value: email })
  if (contacts.facebook) newContacts.push({ type: "facebook", value: contacts.facebook })
  if (contacts.instagram) newContacts.push({ type: "instagram", value: contacts.instagram })
  if (contacts.bookingUrl) newContacts.push({ type: "booking_url", value: contacts.bookingUrl })

  for (const c of newContacts) {
    if (existingValues.has(`${c.type}:${c.value}`)) continue
    await prisma.contact.create({ data: { businessId, type: c.type, value: c.value } })
  }

  return { websiteAuditId: audit.id, score: pagespeed?.performanceScore ?? null, findings, contacts }
}
