import type { SiteFetchResult } from "./types"

const USER_AGENT = "Mozilla/5.0 (compatible; ExtolemProspectOS/1.0; +internal-prospecting-tool)"

function normalizeUrl(input: string): string {
  const trimmed = input.trim()
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
}

/** Fetches a page with a short timeout — audits must stay fast enough for a serverless function. */
export async function fetchSite(url: string, timeoutMs = 10_000): Promise<SiteFetchResult> {
  const target = normalizeUrl(url)
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const res = await fetch(target, {
      headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
      redirect: "follow",
      signal: controller.signal,
    })
    const html = await res.text()
    return { url: target, finalUrl: res.url, status: res.status, ok: res.ok, html, fetchedAt: new Date().toISOString() }
  } catch {
    return { url: target, finalUrl: target, status: null, ok: false, html: "", fetchedAt: new Date().toISOString() }
  } finally {
    clearTimeout(timeout)
  }
}

const CANDIDATE_PATHS = ["/contact", "/contact-us", "/contact-us/", "/get-a-quote", "/book", "/booking"]

/** Fetches the homepage plus the first contact-style subpage that resolves. */
export async function fetchSiteWithContactPage(
  url: string,
): Promise<{ homepage: SiteFetchResult; contactPage: SiteFetchResult | null }> {
  const homepage = await fetchSite(url)
  if (!homepage.ok) return { homepage, contactPage: null }

  const base = new URL(homepage.finalUrl)
  for (const path of CANDIDATE_PATHS) {
    const candidate = await fetchSite(new URL(path, base).toString(), 6000)
    if (candidate.ok && candidate.html.length > 200) {
      return { homepage, contactPage: candidate }
    }
  }
  return { homepage, contactPage: null }
}
