import { NextResponse } from "next/server"
import { z } from "zod"
import { parseSearchIntent } from "@/lib/discovery/parseQuery"

const schema = z.object({ text: z.string().min(3) })

export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "Describe what you're looking for." }, { status: 400 })
  }

  const intent = await parseSearchIntent(parsed.data.text)
  if (!intent) {
    return NextResponse.json({ error: "Could not understand that. Try naming a trade and a suburb." }, { status: 422 })
  }

  return NextResponse.json(intent)
}
