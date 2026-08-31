const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"

const DEFAULT_MODEL = "llama-3.3-70b-versatile"

export function isGroqConfigured(): boolean {
  return Boolean(process.env.GROQ_API_KEY)
}

function extractJson(content: string): string {
  const trimmed = content.trim()

  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return trimmed
  }

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced?.[1]) {
    return fenced[1].trim()
  }

  const firstBrace = trimmed.indexOf("{")
  const lastBrace = trimmed.lastIndexOf("}")

  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1)
  }

  return trimmed
}

export async function chatJson<T>(
  systemPrompt: string,
  userMessage: string,
): Promise<T | null> {
  const key = process.env.GROQ_API_KEY

  if (!key) {
    console.error("GROQ_API_KEY is not configured")
    return null
  }

  try {
    const response = await fetch(GROQ_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.GROQ_MODEL || DEFAULT_MODEL,
        messages: [
          {
            role: "system",
            content: systemPrompt,
          },
          {
            role: "user",
            content: userMessage,
          },
        ],
        temperature: 0.1,
        response_format: {
          type: "json_object",
        },
      }),
      signal: AbortSignal.timeout(20_000),
      cache: "no-store",
    })

    if (!response.ok) {
      const error = await response.text()
      console.error("Groq request failed:", response.status, error)
      return null
    }

    const data = await response.json()
    const content = data?.choices?.[0]?.message?.content

    if (typeof content !== "string" || !content.trim()) {
      return null
    }

    return JSON.parse(extractJson(content)) as T
  } catch (error) {
    console.error("Groq JSON request failed:", error)
    return null
  }
}
