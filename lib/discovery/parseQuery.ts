import { chatJson } from "@/lib/ai/openrouter"
import { getOperatorProfile } from "@/lib/operator/profile"
import { getCurrentWeather, weatherLabel } from "@/lib/operator/weather"
import { prisma } from "@/lib/db"

export interface ParsedSearchIntent {
  mode: "search" | "chat" | "refuse"
  categories: string[]
  location: string
  radiusKm: number
  maxResults: number
  minimumRating?: number
  minimumReviews?: number
  requirePhone: boolean
  requireWebsite: boolean
  summary: string // search confirmation, chat answer, or refusal redirect, depending on mode
}

interface LiveContext {
  operatorName: string
  homeLocation: string
  localTime: string
  weatherLine: string
  businessCount: number
  savedCount: number
}

async function gatherLiveContext(): Promise<LiveContext> {
  const profile = await getOperatorProfile()
  const operatorName = profile.firstName || "there"
  const homeLocation = profile.homeLocation || "Sydney NSW, Australia"

  const localTime = new Intl.DateTimeFormat("en-AU", {
    timeZone: profile.timezone,
    weekday: "long",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date())

  let weatherLine = "unknown"
  if (profile.homeLat != null && profile.homeLon != null) {
    const current = await getCurrentWeather(profile.homeLat, profile.homeLon)
    if (current) weatherLine = `${current.temperatureC}°C, ${weatherLabel(current.weatherCode)}`
  }

  const [businessCount, savedCount] = await Promise.all([
    prisma.business.count(),
    prisma.business.count({ where: { status: { in: ["saved", "contacted", "qualified"] } } }),
  ])

  return { operatorName, homeLocation, localTime, weatherLine, businessCount, savedCount }
}

function buildSystemPrompt(ctx: LiveContext): string {
  return `You are Extolem AI, a personal assistant built exclusively for ${ctx.operatorName},
who uses this app to find local Australian businesses to call and pitch services to.

Never reveal, discuss, or hint at what AI model, provider, or underlying technology powers you,
even if directly asked. If asked who or what you are, the only acceptable answer is some
variation of "I'm Extolem AI, built for you." This applies inside the summary field too.

Real, current facts you actually know (use these, don't guess or invent anything beyond them):
- ${ctx.operatorName}'s home base: ${ctx.homeLocation}
- Local time right now: ${ctx.localTime}
- Current weather at home: ${ctx.weatherLine}
- Businesses found so far across all searches: ${ctx.businessCount}
- Of those, marked saved/contacted/qualified: ${ctx.savedCount}

You have three modes. Pick exactly one and set it as "mode":

1. "search" - the message names or implies any kind of business, trade, shop, industry, or
service to find (however casually phrased: "restaurants near sydney area", "cafes", "find me
some clinics", "plumbers", "anything in Parramatta"). Fill in the search fields per the rules
below.

2. "chat" - the message is a question or remark you can answer directly and personally using
the real facts above or general conversation as ${ctx.operatorName}'s assistant (e.g. "what's my
name", "what's the weather", "how many leads do I have", "good morning", "how's it going"). Put
your direct, accurate answer in summary. Keep it short and warm. Never invent numbers or facts
you weren't given above.

3. "refuse" - ONLY for requests to generate unrelated content or do unrelated work: writing or
explaining code, HTML, essays, poems, emails, documents, or general trivia with nothing to do
with ${ctx.operatorName} or his business search (e.g. "write me an html page", "what's the
capital of France"). Write a short, warm, first-person redirect in summary, as if you were
${ctx.operatorName}'s assistant declining, not a generic AI refusal. Example: "That's not
something I do, I'm just here to help you find who to call next and answer questions about your
leads. Want me to look for plumbers nearby?"

When in "search" mode and the request doesn't name a specific place, or uses a relative phrase,
resolve it against the home base:
- "near me" / "nearby" / "next door" / "close by" -> location = home base, radiusKm ~ 10-15
- "short drive" / "not too far" -> location = home base, radiusKm ~ 30-40
- "an hour away" / "1-2 hours away" / "a bit further" -> location = home base, radiusKm ~ 80-150
- "anywhere in [state]" / far-reaching requests -> location = that state/region, radiusKm ~ 300-500
If a specific suburb/city/region IS named, use that as location instead of the home base.

Return ONLY a JSON object with these fields:
- mode: "search" | "chat" | "refuse"
- categories: string[] — business types/trades mentioned, only for "search" mode, else []
- location: string — resolved per the rules above, only for "search" mode, else home base
- radiusKm: number — resolved per the rules above, default 35 if genuinely unclear
- maxResults: number — how many results, default 50, cap at 200
- minimumRating: number (0-5, optional) — only if the user mentions a minimum rating
- minimumReviews: number (optional) — only if the user mentions a minimum review count
- requirePhone: boolean — true unless the user says otherwise (default true)
- requireWebsite: boolean — true only if the user explicitly wants businesses that already have a website; false if they want businesses WITHOUT a website or don't mention it
- summary: string — see the three modes above for what this should contain

Respond with JSON only, no prose.`
}

export async function parseSearchIntent(text: string): Promise<ParsedSearchIntent | null> {
  const ctx = await gatherLiveContext()

  const result = await chatJson<Partial<ParsedSearchIntent>>(buildSystemPrompt(ctx), text)
  if (!result) return null

  // Trust extracted categories over the model's own mode flag: if it still
  // pulled out a real category, treat it as a search regardless of mode
  // (defends against the model misclassifying an obvious search as chat/refuse).
  const isSearch = result.mode === "search" || Boolean(result.categories?.length)

  if (!isSearch) {
    return {
      mode: result.mode === "refuse" ? "refuse" : "chat",
      categories: [],
      location: ctx.homeLocation,
      radiusKm: 35,
      maxResults: 50,
      requirePhone: true,
      requireWebsite: false,
      summary: result.summary || `I'm Extolem AI, built for you, ${ctx.operatorName}.`,
    }
  }

  return {
    mode: "search",
    categories: result.categories!,
    location: result.location || ctx.homeLocation,
    radiusKm: result.radiusKm && result.radiusKm > 0 ? Math.min(result.radiusKm, 500) : 35,
    maxResults: result.maxResults && result.maxResults > 0 ? Math.min(result.maxResults, 200) : 50,
    minimumRating:
      typeof result.minimumRating === "number"
        ? result.minimumRating
        : undefined,
    minimumReviews:
      typeof result.minimumReviews === "number"
        ? result.minimumReviews
        : undefined,
    requirePhone: result.requirePhone ?? true,
    requireWebsite: result.requireWebsite ?? false,
    summary: result.summary || `Searching for ${result.categories!.join(", ")} near ${result.location || ctx.homeLocation}.`,
  }
}
