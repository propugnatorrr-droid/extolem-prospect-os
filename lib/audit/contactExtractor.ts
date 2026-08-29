export interface ExtractedContacts {
  phones: string[]
  emails: string[]
  facebook?: string
  instagram?: string
  linkedin?: string
  youtube?: string
  whatsapp?: string
  bookingUrl?: string
  hasContactForm: boolean
}

const PHONE_REGEX = /(?:\+?61|0)[\s.-]?[2-478][\s.-]?\d{2,4}[\s.-]?\d{3,4}[\s.-]?\d{0,4}\b/g
const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g
const SOCIAL_PATTERNS: Record<string, RegExp> = {
  facebook: /https?:\/\/(?:www\.)?facebook\.com\/[a-zA-Z0-9._-]+/,
  instagram: /https?:\/\/(?:www\.)?instagram\.com\/[a-zA-Z0-9._-]+/,
  linkedin: /https?:\/\/(?:www\.)?linkedin\.com\/(?:company|in)\/[a-zA-Z0-9._-]+/,
  youtube: /https?:\/\/(?:www\.)?youtube\.com\/[a-zA-Z0-9._@\/-]+/,
  whatsapp: /https?:\/\/(?:wa\.me|api\.whatsapp\.com)\/[0-9+]+/,
}
const BOOKING_PATTERNS = [
  /https?:\/\/[a-zA-Z0-9.-]*calendly\.com[^\s"'<>]*/,
  /https?:\/\/[a-zA-Z0-9.-]*setmore\.com[^\s"'<>]*/,
  /https?:\/\/[a-zA-Z0-9.-]*acuityscheduling\.com[^\s"'<>]*/,
  /https?:\/\/[a-zA-Z0-9.-]*bookings?\.[a-zA-Z0-9.-]+[^\s"'<>]*/,
]

function unique(values: string[]): string[] {
  return Array.from(new Set(values.map((v) => v.trim()))).filter(Boolean)
}

function looksLikeJunkPhone(phone: string): boolean {
  const digits = phone.replace(/\D/g, "")
  return digits.length < 8 || /^(\d)\1+$/.test(digits)
}

export function extractContacts(...htmlBlobs: string[]): ExtractedContacts {
  const html = htmlBlobs.join("\n")

  const phones = unique(
    (html.match(PHONE_REGEX) || []).filter((p) => !looksLikeJunkPhone(p)),
  ).slice(0, 5)

  const emails = unique(
    (html.match(EMAIL_REGEX) || []).filter(
      (e) => !e.endsWith(".png") && !e.endsWith(".jpg") && !e.endsWith(".svg") && !e.includes("wixpress"),
    ),
  ).slice(0, 5)

  const social: Record<string, string | undefined> = {}
  for (const [key, pattern] of Object.entries(SOCIAL_PATTERNS)) {
    const match = html.match(pattern)
    if (match) social[key] = match[0]
  }

  let bookingUrl: string | undefined
  for (const pattern of BOOKING_PATTERNS) {
    const match = html.match(pattern)
    if (match) {
      bookingUrl = match[0]
      break
    }
  }

  const hasContactForm =
    /<form[\s\S]{0,500}?(name=["']?email|type=["']?email|contact)/i.test(html) ||
    /<form[\s\S]*?<\/form>/i.test(html)

  return {
    phones,
    emails,
    facebook: social.facebook,
    instagram: social.instagram,
    linkedin: social.linkedin,
    youtube: social.youtube,
    whatsapp: social.whatsapp,
    bookingUrl,
    hasContactForm,
  }
}
