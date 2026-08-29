import { NextResponse } from "next/server"
import { z } from "zod"
import { runDiscovery } from "@/lib/discovery/run"

const requestSchema = z.object({
  categories: z.array(z.string().min(2)).min(1),
  location: z.string().min(2),
  radiusKm: z.number().min(1).max(500).default(35),
  maxResults: z.number().int().min(1).max(2000).default(100),
  minimumRating: z.number().min(0).max(5).optional(),
  minimumReviews: z.number().int().min(0).optional(),
  requirePhone: z.boolean().optional(),
  requireWebsite: z.boolean().optional(),
  sources: z
    .array(z.enum(["google_maps_apify", "yellowpages_au", "google_search_apify", "openstreetmap"]))
    .min(1),
})

export async function POST(request: Request) {
  const body = await request.json()
  const parsed = requestSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid discovery request", details: parsed.error.flatten() }, { status: 400 })
  }

  try {
    const result = await runDiscovery(parsed.data)
    return NextResponse.json(result)
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Discovery run failed" },
      { status: 500 },
    )
  }
}
