export interface ConversionChecks {
  hasMobileViewport: boolean
  hasClickToCall: boolean
  hasContactForm: boolean
  hasOnlineBooking: boolean
  hasLiveChatOrBot: boolean
  hasTestimonials: boolean
  hasFaq: boolean
  hasSchemaOrg: boolean
  hasLocalBusinessSchema: boolean
  hasSitemap: boolean
  hasHttps: boolean
  titleLength: number
  metaDescriptionLength: number
  hasH1: boolean
}

export function runConversionChecks(
  html: string,
  finalUrl: string,
  hasContactForm: boolean,
  hasBookingUrl: boolean,
  hasChatTech: boolean,
): ConversionChecks {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  const metaDescMatch = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i)

  return {
    hasMobileViewport: /<meta[^>]+name=["']viewport["']/i.test(html),
    hasClickToCall: /href=["']tel:[^"']+["']/i.test(html),
    hasContactForm,
    hasOnlineBooking: hasBookingUrl || /book\s*(a\s*)?(appointment|now|online)/i.test(html),
    hasLiveChatOrBot: hasChatTech,
    hasTestimonials: /testimonial|what our (clients?|customers?) say|reviews?\s*from/i.test(html),
    hasFaq: /frequently asked questions|\bFAQs?\b/i.test(html),
    hasSchemaOrg: /application\/ld\+json/i.test(html),
    hasLocalBusinessSchema: /"@type"\s*:\s*"LocalBusiness"/i.test(html),
    hasSitemap: false, // resolved separately via robots.txt/sitemap.xml fetch if needed
    hasHttps: finalUrl.startsWith("https://"),
    titleLength: titleMatch ? titleMatch[1].trim().length : 0,
    metaDescriptionLength: metaDescMatch ? metaDescMatch[1].trim().length : 0,
    hasH1: /<h1[\s>]/i.test(html),
  }
}
