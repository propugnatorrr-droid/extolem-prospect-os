// Google PageSpeed Insights API — free, no key required at low volume
// (an optional PAGESPEED_API_KEY raises the rate limit). Using this instead
// of running Lighthouse ourselves avoids needing a headless Chrome instance
// inside a Vercel serverless function, which is slow and size-constrained.
const PAGESPEED_URL = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed"

export interface PageSpeedResult {
  performanceScore: number | null // 0-100
  seoScore: number | null
  accessibilityScore: number | null
  lcpMs: number | null
  isMobileFriendly: boolean | null
}

export async function runPageSpeed(url: string): Promise<PageSpeedResult | null> {
  const key = process.env.PAGESPEED_API_KEY
  const params = new URLSearchParams({ url, strategy: "mobile", category: "performance" })
  params.append("category", "seo")
  params.append("category", "accessibility")
  if (key) params.set("key", key)

  try {
    const res = await fetch(`${PAGESPEED_URL}?${params.toString()}`, { signal: AbortSignal.timeout(25_000) })
    if (!res.ok) return null
    const data = await res.json()
    const categories = data.lighthouseResult?.categories
    const audits = data.lighthouseResult?.audits

    return {
      performanceScore: categories?.performance ? Math.round(categories.performance.score * 100) : null,
      seoScore: categories?.seo ? Math.round(categories.seo.score * 100) : null,
      accessibilityScore: categories?.accessibility ? Math.round(categories.accessibility.score * 100) : null,
      lcpMs: audits?.["largest-contentful-paint"]?.numericValue ?? null,
      isMobileFriendly: audits?.["viewport"] ? audits["viewport"].score === 1 : null,
    }
  } catch {
    return null
  }
}
