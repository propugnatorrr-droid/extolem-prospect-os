import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/db"
import type { DiscoveryRequest, NormalizedBusiness } from "./types"
import { enrichWebsiteContacts } from "@/lib/enrichment/website-contact"

function cleanString(value?: string): string | undefined {
  if (!value) return undefined

  const cleaned = value.trim()
  return cleaned || undefined
}

function normalizePhone(value?: string): string | undefined {
  if (!value) return undefined

  const digits = value.replace(/\D/g, "")

  if (digits.length < 8) return undefined

  if (digits.startsWith("61") && digits.length >= 11) {
    return `0${digits.slice(2)}`
  }

  return digits
}

function normalizeWebsite(value?: string): string | undefined {
  if (!value) return undefined

  try {
    const parsed = new URL(
      value.startsWith("http://") || value.startsWith("https://")
        ? value
        : `https://${value}`,
    )

    parsed.hash = ""
    parsed.search = ""

    const pathname =
      parsed.pathname === "/" ? "" : parsed.pathname.replace(/\/+$/, "")

    return `${parsed.protocol}//${parsed.hostname
      .replace(/^www\./, "")
      .toLowerCase()}${pathname}`
  } catch {
    return undefined
  }
}

function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .replace(/\b(pty|ltd|limited|australia|australian)\b/g, "")
    .replace(/[^a-z0-9]/g, "")
}

function passesFilters(
  record: NormalizedBusiness,
  request: DiscoveryRequest,
): boolean {
  if (!record.name.trim()) return false
  if (request.requirePhone && !record.phone) return false
  if (request.requireWebsite && !record.website) return false

  if (
    request.minimumRating != null &&
    (record.rating == null || record.rating < request.minimumRating)
  ) {
    return false
  }

  if (
    request.minimumReviews != null &&
    (record.reviewCount == null ||
      record.reviewCount < request.minimumReviews)
  ) {
    return false
  }

  return true
}

async function findExistingBusiness(record: NormalizedBusiness) {
  const phone = normalizePhone(record.phone)
  const website = normalizeWebsite(record.website)
const placeId =
  record.source === "google_maps_apify"
    ? cleanString(record.sourceId)
    : undefined

  const or: Prisma.BusinessWhereInput[] = []

  if (placeId) or.push({ placeId })
  if (phone) or.push({ phone })
  if (website) or.push({ website })

  if (or.length) {
    const strongMatch = await prisma.business.findFirst({
      where: { OR: or },
    })

    if (strongMatch) return strongMatch
  }

  const postcode = cleanString(record.postcode)
  const nameKey = normalizeName(record.name)

  if (postcode && nameKey) {
    const possibleMatches = await prisma.business.findMany({
      where: { postcode },
      take: 100,
    })

    const match = possibleMatches.find(
      (business) => normalizeName(business.name) === nameKey,
    )

    if (match) return match
  }

  return null
}

async function createOrMergeBusiness(record: NormalizedBusiness) {
  const normalizedPhone = normalizePhone(record.phone)
  const normalizedWebsite = normalizeWebsite(record.website)
  const placeId =
(record.source === "google_maps_apify" ||
  record.source === "google_places_api")
      ? cleanString(record.sourceId)
      : undefined

  const existing = await findExistingBusiness({
    ...record,
    phone: normalizedPhone,
    website: normalizedWebsite,
  })

  if (existing) {
    return prisma.business.update({
      where: { id: existing.id },
      data: {
        name: existing.name || record.name,
        category: existing.category || cleanString(record.category),
        phone: existing.phone || normalizedPhone,
        website: existing.website || normalizedWebsite,
        street: existing.street || cleanString(record.street),
        suburb: existing.suburb || cleanString(record.suburb),
        state: existing.state || cleanString(record.state),
        postcode: existing.postcode || cleanString(record.postcode),
        latitude: existing.latitude ?? record.latitude,
        longitude: existing.longitude ?? record.longitude,
        rating:
          record.rating != null &&
          (existing.rating == null || record.rating > existing.rating)
            ? record.rating
            : existing.rating,
        reviewCount:
          record.reviewCount != null &&
          (existing.reviewCount == null ||
            record.reviewCount > existing.reviewCount)
            ? record.reviewCount
            : existing.reviewCount,
        placeId: existing.placeId || placeId,
      },
    })
  }

  try {
    return await prisma.business.create({
      data: {
        name: record.name.trim(),
        category: cleanString(record.category),
        phone: normalizedPhone,
        website: normalizedWebsite,
        street: cleanString(record.street),
        suburb: cleanString(record.suburb),
        state: cleanString(record.state),
        postcode: cleanString(record.postcode),
        country: cleanString(record.country) || "AU",
        latitude: record.latitude,
        longitude: record.longitude,
        rating: record.rating,
        reviewCount: record.reviewCount,
        placeId,
      },
    })
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      const duplicate = await findExistingBusiness({
        ...record,
        phone: normalizedPhone,
        website: normalizedWebsite,
      })

      if (duplicate) return duplicate
    }

    throw error
  }
}

async function saveSource(
  businessId: string,
  record: NormalizedBusiness,
): Promise<void> {
  const sourceId =
    cleanString(record.sourceId) ||
    cleanString(record.sourceUrl) ||
    `${normalizeName(record.name)}:${record.postcode || "unknown"}`

  await prisma.businessSource.upsert({
    where: {
      businessId_source_sourceId: {
        businessId,
        source: record.source,
        sourceId,
      },
    },
    create: {
      businessId,
      source: record.source,
      sourceId,
      sourceUrl: cleanString(record.sourceUrl),
      raw: JSON.stringify(record.raw),
    },
    update: {
      sourceUrl: cleanString(record.sourceUrl),
      raw: JSON.stringify(record.raw),
      fetchedAt: new Date(),
    },
  })
}

async function saveContact(
  businessId: string,
  type: string,
  value?: string,
  sourceUrl?: string,
): Promise<void> {
  const cleaned = cleanString(value)
  if (!cleaned) return

  await prisma.contact.upsert({
    where: {
      businessId_type_value: {
        businessId,
        type,
        value: cleaned,
      },
    },
    create: {
      businessId,
      type,
      value: cleaned,
      sourceUrl,
      confidence: 0.8,
    },
    update: {
      sourceUrl,
      confidence: 0.8,
    },
  })
}

export async function persistBusinesses(
  searchRunId: string,
  records: NormalizedBusiness[],
  request: DiscoveryRequest,
): Promise<number> {
  const uniqueRecords = Array.from(
    new Map(
      records
        .filter((record) => record.name?.trim())
        .map((record) => {
          const key =
            record.sourceId ||
            normalizePhone(record.phone) ||
            normalizeWebsite(record.website) ||
            `${normalizeName(record.name)}:${record.postcode || ""}`

          return [key, record] as const
        }),
    ).values(),
  )

  const enrichmentLimit = Math.min(
    Number(
      process.env.WEBSITE_ENRICHMENT_LIMIT || 12,
    ),
    25,
  )

  const enrichedRecords =
    process.env.ENABLE_WEBSITE_ENRICHMENT === "false"
      ? uniqueRecords
      : await enrichWebsiteContacts(
          uniqueRecords,
          enrichmentLimit,
        )

  const filtered = enrichedRecords
    .filter((record) =>
      passesFilters(record, request),
    )
    .slice(0, request.maxResults)

  const batchSize = 8

  for (
    let index = 0;
    index < filtered.length;
    index += batchSize
  ) {
    const batch = filtered.slice(
      index,
      index + batchSize,
    )

    await Promise.all(
      batch.map(async (record) => {
        const business =
          await createOrMergeBusiness(record)

        await prisma.searchRunBusiness.upsert({
          where: {
            searchRunId_businessId: {
              searchRunId,
              businessId: business.id,
            },
          },
          create: {
            searchRunId,
            businessId: business.id,
          },
          update: {},
        })

        await Promise.all([
          saveSource(business.id, record),
          saveContact(
            business.id,
            "phone",
            normalizePhone(record.phone),
            record.sourceUrl ||
              record.website,
          ),
          saveContact(
            business.id,
            "email",
            record.email?.toLowerCase(),
            record.sourceUrl ||
              record.website,
          ),
        ])
      }),
    )
  }

  return prisma.searchRunBusiness.count({
    where: { searchRunId },
  })
}
