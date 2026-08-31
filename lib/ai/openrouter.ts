// Thin OpenRouter chat-completions wrapper. Used only for parsing a
// free-text search request into structured discovery parameters — every
// other feature in this app is deterministic (no LLM) by design, see
// lib/opportunity/engine.ts.
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
const MODEL = "upstage/solar-pro4"

export function isOpenRouterConfigured(): boolean {
  return Boolean(process.env.OPENROUTER_API_KEY)
}

export async function chatJson<T>(
  systemPrompt: string,
  userMessage: string
): Promise<T | null> {
  const key = process.env.OPENROUTER_API_KEY
  if (!key) return null

  try {
    const res = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage },
        ],
        response_format: { type: "json_object" },
        temperature: 0.1,
      }),
      signal: AbortSignal.timeout(20_000),
    })

    if (!res.ok) return null

    const data = await res.json()
    const content = data.choices?.[0]?.message?.content

    if (!content) return null

    return JSON.parse(content) as T
  } catch {
    return null
  }
}
