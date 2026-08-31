import { lookup } from "node:dns/promises"
import { isIP } from "node:net"
import type { NormalizedBusiness } from "@/lib/discovery/types"

const USER_AGENT =
  "Mozilla/5.0 (compatible; ExtolemProspectOS/1.0; business contact discovery)"

const CONTACT_PATHS = [
  "/contact",
  "/contact-us",
  "/about",
  "/about-us",
]

interface ExtractedContacts {
  phone?: string
  email?: string
  sourceUrl?: string
}

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&#38;/gi, "&")
    .replace(/&commat;/gi, "@")
    .replace(/&#64;/gi, "@")
    .replace(/&period;/gi, ".")
    .replace(/&#46;/gi, ".")
    .replace(/&nbsp;/gi, " ")
}

function cleanPhone(
  value: string | undefined,
): string | undefined {
  if (!value) return undefined

  let digits = value.replace(/\D/g, "")

  if (digits.startsWith("61") && digits.length >= 11) {
    digits = `0${digits.slice(2)}`
  }

  if (
    digits.length < 8 ||
    digits.length > 12
  ) {
    return undefined
  }

  return digits
}

function cleanEmail(
  value: string | undefined,
): string | undefined {
  if (!value) return undefined

  const email = value
    .trim()
    .toLowerCase()
    .replace(/^mailto:/, "")
    .split("?")[0]

  if (
    !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(
      email,
    )
  ) {
    return undefined
  }

  const blocked = [
    "example.com",
    "sentry.io",
    "wixpress.com",
    "wordpress.org",
    "schema.org",
  ]

  if (
    blocked.some((domain) =>
      email.endsWith(`@${domain}`),
    )
  ) {
    return undefined
  }

  return email
}

function isPrivateIpv4(address: string): boolean {
  const parts = address
    .split(".")
    .map((part) => Number(part))

  if (
    parts.length !== 4 ||
    parts.some(
      (part) =>
        !Number.isInteger(part) ||
        part < 0 ||
        part > 255,
    )
  ) {
    return true
  }

  const [a, b] = parts

  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224
  )
}

function isPrivateIpv6(address: string): boolean {
  const normalized = address.toLowerCase()

  return (
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe8") ||
    normalized.startsWith("fe9") ||
    normalized.startsWith("fea") ||
    normalized.startsWith("feb")
  )
}

async function assertPublicUrl(
  value: string,
): Promise<URL> {
  const url = new URL(value)

  if (
    url.protocol !== "http:" &&
    url.protocol !== "https:"
  ) {
    throw new Error("Unsupported website protocol")
  }

  const hostname = url.hostname.toLowerCase()

  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local")
  ) {
    throw new Error("Private website address")
  }

  if (isIP(hostname)) {
    if (
      isPrivateIpv4(hostname) ||
      isPrivateIpv6(hostname)
    ) {
      throw new Error("Private website address")
    }

    return url
  }

  const addresses = await lookup(hostname, {
    all: true,
    verbatim: true,
  })

  if (!addresses.length) {
    throw new Error("Website hostname did not resolve")
  }

  for (const result of addresses) {
    if (
      (result.family === 4 &&
        isPrivateIpv4(result.address)) ||
      (result.family === 6 &&
        isPrivateIpv6(result.address))
    ) {
      throw new Error("Private website address")
    }
  }

  return url
}

async function fetchHtml(
  initialUrl: string,
): Promise<{
  html: string
  finalUrl: string
} | null> {
  let currentUrl = initialUrl

  for (let redirect = 0; redirect < 4; redirect += 1) {
    const safeUrl = await assertPublicUrl(currentUrl)

    const response = await fetch(safeUrl, {
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "User-Agent": USER_AGENT,
      },
      redirect: "manual",
      signal: AbortSignal.timeout(7_000),
      cache: "no-store",
    })

    if (
      response.status >= 300 &&
      response.status < 400
    ) {
      const location = response.headers.get("location")
      if (!location) return null

      currentUrl = new URL(
        location,
        safeUrl,
      ).toString()

      continue
    }

    if (!response.ok) return null

    const contentType =
      response.headers.get("content-type") || ""

    if (
      !contentType
        .toLowerCase()
        .includes("text/html")
    ) {
      return null
    }

    const contentLength = Number(
      response.headers.get("content-length") || 0,
    )

    if (
      Number.isFinite(contentLength) &&
      contentLength > 2_000_000
    ) {
      return null
    }

    const html = (await response.text()).slice(
      0,
      2_000_000,
    )

    return {
      html,
      finalUrl: safeUrl.toString(),
    }
  }

  return null
}

function extractPhones(html: string): string[] {
  const decoded = decodeHtml(html)
  const phones = new Set<string>()

  const telephoneLinks =
    decoded.matchAll(
      /href\s*=\s*["']tel:([^"'?#]+)[^"']*["']/gi,
    )

  for (const match of telephoneLinks) {
    const phone = cleanPhone(match[1])
    if (phone) phones.add(phone)
  }

  const australianNumbers =
    decoded.matchAll(
      /(?:\+?61[\s().-]?(?:0[\s().-]?)?|0)(?:2|3|4|7|8)[\s().-]?\d{4}[\s.-]?\d{4}/g,
    )

  for (const match of australianNumbers) {
    const phone = cleanPhone(match[0])
    if (phone) phones.add(phone)
  }

  const localNumbers =
    decoded.matchAll(
      /\b(?:1300|1800)[\s.-]?\d{3}[\s.-]?\d{3}\b/g,
    )

  for (const match of localNumbers) {
    const phone = cleanPhone(match[0])
    if (phone) phones.add(phone)
  }

  return Array.from(phones)
}

function extractEmails(html: string): string[] {
  const decoded = decodeHtml(html)
  const emails = new Set<string>()

  const mailLinks =
    decoded.matchAll(
      /href\s*=\s*["']mailto:([^"'?]+)[^"']*["']/gi,
    )

  for (const match of mailLinks) {
    const email = cleanEmail(match[1])
    if (email) emails.add(email)
  }

  const visibleEmails =
    decoded.matchAll(
      /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
    )

  for (const match of visibleEmails) {
    const email = cleanEmail(match[0])
    if (email) emails.add(email)
  }

  return Array.from(emails)
}

function contactLinks(
  html: string,
  currentUrl: string,
): string[] {
  const base = new URL(currentUrl)
  const links = new Set<string>()

  const matches = html.matchAll(
    /href\s*=\s*["']([^"'#]+)["']/gi,
  )

  for (const match of matches) {
    try {
      const url = new URL(match[1], base)

      if (url.hostname !== base.hostname) continue

      const text = url.pathname.toLowerCase()

      if (
        text.includes("contact") ||
        text.includes("about")
      ) {
        url.hash = ""
        links.add(url.toString())
      }
    } catch {
      // Ignore malformed links.
    }
  }

  for (const path of CONTACT_PATHS) {
    links.add(new URL(path, base).toString())
  }

  return Array.from(links).slice(0, 2)
}

function normalizedWebsite(
  value: string,
): string {
  if (
    value.startsWith("http://") ||
    value.startsWith("https://")
  ) {
    return value
  }

  return `https://${value}`
}

export async function extractWebsiteContacts(
  website: string,
): Promise<ExtractedContacts> {
  try {
    const home = await fetchHtml(
      normalizedWebsite(website),
    )

    if (!home) return {}

    let phones = extractPhones(home.html)
    let emails = extractEmails(home.html)
    let sourceUrl = home.finalUrl

    if (!phones.length || !emails.length) {
      const links = contactLinks(
        home.html,
        home.finalUrl,
      )

      for (const link of links) {
        try {
          const page = await fetchHtml(link)
          if (!page) continue

          phones = [
            ...phones,
            ...extractPhones(page.html),
          ]

          emails = [
            ...emails,
            ...extractEmails(page.html),
          ]

          if (
            phones.length ||
            emails.length
          ) {
            sourceUrl = page.finalUrl
          }

          if (
            phones.length &&
            emails.length
          ) {
            break
          }
        } catch {
          // Continue to the next contact page.
        }
      }
    }

    return {
      phone: Array.from(new Set(phones))[0],
      email: Array.from(new Set(emails))[0],
      sourceUrl,
    }
  } catch {
    return {}
  }
}

export async function enrichWebsiteContacts(
  records: NormalizedBusiness[],
  limit = 12,
): Promise<NormalizedBusiness[]> {
  const output = [...records]
  const candidates = output
    .map((record, index) => ({
      record,
      index,
    }))
    .filter(
      ({ record }) =>
        Boolean(record.website) &&
        (!record.phone || !record.email),
    )
    .slice(0, Math.max(0, limit))

  const concurrency = 4

  for (
    let index = 0;
    index < candidates.length;
    index += concurrency
  ) {
    const batch = candidates.slice(
      index,
      index + concurrency,
    )

    const enriched = await Promise.all(
      batch.map(async ({ record, index: recordIndex }) => {
        const contacts = await extractWebsiteContacts(
          record.website!,
        )

        return {
          recordIndex,
          contacts,
        }
      }),
    )

    for (const result of enriched) {
      const current = output[result.recordIndex]

      output[result.recordIndex] = {
        ...current,
        phone:
          current.phone ||
          result.contacts.phone,
        email:
          current.email ||
          result.contacts.email,
        raw: {
          ...current.raw,
          websiteContactSource:
            result.contacts.sourceUrl,
        },
      }
    }
  }

  return output
}
