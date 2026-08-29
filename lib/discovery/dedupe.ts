import type { NormalizedBusiness } from "./types"

function normalizePhone(phone?: string): string | undefined {
  if (!phone) return undefined
  const digits = phone.replace(/[^\d]/g, "")
  return digits.length >= 8 ? digits.slice(-9) : undefined // last 9 digits, drops country/area formatting noise
}

function normalizeDomain(website?: string): string | undefined {
  if (!website) return undefined
  try {
    const url = website.startsWith("http") ? website : `https://${website}`
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase()
  } catch {
    return undefined
  }
}

function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "")
}

/**
 * Merges records that are almost certainly the same business, in priority
 * order: same source placeId > same phone > same website domain > same
 * normalized name + postcode. Earlier sources in the input array win when
 * merging field values (first non-empty wins), but all raw records and
 * source ids are preserved on the merged result via `sources`.
 */
export function dedupeBusinesses(
  records: NormalizedBusiness[],
): Array<{ business: NormalizedBusiness; sources: NormalizedBusiness[] }> {
  const groups: Array<{ business: NormalizedBusiness; sources: NormalizedBusiness[] }> = []

  const keyOf = (b: NormalizedBusiness) => ({
    placeId: b.source === "google_maps_apify" ? b.sourceId : undefined,
    phone: normalizePhone(b.phone),
    domain: normalizeDomain(b.website),
    nameKey: `${normalizeName(b.name)}:${b.postcode || ""}`,
  })

  for (const record of records) {
    const key = keyOf(record)
    const match = groups.find((g) => {
      const gk = keyOf(g.business)
      return (
        (key.placeId && gk.placeId === key.placeId) ||
        (key.phone && gk.phone === key.phone) ||
        (key.domain && gk.domain === key.domain) ||
        (key.nameKey === gk.nameKey && key.nameKey.length > 1)
      )
    })

    if (match) {
      match.sources.push(record)
      match.business = mergeFields(match.business, record)
    } else {
      groups.push({ business: record, sources: [record] })
    }
  }

  return groups
}

function mergeFields(a: NormalizedBusiness, b: NormalizedBusiness): NormalizedBusiness {
  return {
    ...a,
    phone: a.phone || b.phone,
    email: a.email || b.email,
    website: a.website || b.website,
    street: a.street || b.street,
    suburb: a.suburb || b.suburb,
    state: a.state || b.state,
    postcode: a.postcode || b.postcode,
    latitude: a.latitude ?? b.latitude,
    longitude: a.longitude ?? b.longitude,
    rating: a.rating ?? b.rating,
    reviewCount: a.reviewCount ?? b.reviewCount,
    category: a.category || b.category,
  }
}
