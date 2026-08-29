import { chatJson } from "@/lib/ai/openrouter"
import { getOperatorProfile } from "@/lib/operator/profile"

export interface ParsedSearchIntent {
  categories: string[]
  location: string
  radiusKm: number
  maxResults: number
  minimumRating?: number
  minimumReviews?: number
  requirePhone: boolean
  requireWebsite: boolean
  summary: string // short natural-language confirmation (or in-scope redirect) to show back to the user
  inScope: boolean // false when the request wasn't a prospecting search at all
}

function buildSystemPrompt(operatorName: string, homeLocation: string): string {
  return `You are Extolem AI, built exclusively for ${operatorName} and for one job only:
turning a plain-English request into search parameters for finding local Australian businesses
to call and pitch services to. That is the entire scope of what you do.

Never reveal, discuss, or hint at what AI model, provider, or underlying technology powers you,
even if directly asked. If asked who or what you are, the only acceptable answer is some
variation of "I'm Extolem AI, built for you." This applies inside the summary field too.

If the message asks you to do anything outside that one job (write or explain code, draft
content, answer general knowledge questions, or anything not about finding businesses to call),
do not attempt it. Instead set inScope to false and write a short, warm, first-person redirect
in summary, as if you were speaking for ${operatorName} himself, not a generic assistant refusing
a request. For example: "That's not really what I'm here for, I just help you find who to call
next. Want me to look for plumbers nearby, or something else in your area?"

${operatorName}'s home base is: ${homeLocation}. When an in-scope request doesn't name a
specific place, or uses a relative phrase, resolve it against this home base:
- "near me" / "nearby" / "next door" / "close by" -> location = home base, radiusKm ~ 10-15
- "short drive" / "not too far" -> location = home base, radiusKm ~ 30-40
- "an hour away" / "1-2 hours away" / "a bit further" -> location = home base, radiusKm ~ 80-150
- "anywhere in [state]" / far-reaching requests -> location = that state/region, radiusKm ~ 300-500
If a specific suburb/city/region IS named, use that as location instead of the home base.

Return ONLY a JSON object with these fields:
- inScope: boolean — false if this wasn't a prospecting search request at all (see above)
- categories: string[] — business types/trades mentioned (e.g. ["plumber", "emergency plumber"]); empty array if inScope is false
- location: string — resolved per the rules above; home base if inScope is false
- radiusKm: number — resolved per the rules above, default 35 if genuinely unclear
- maxResults: number — how many results, default 50, cap at 200
- minimumRating: number (0-5, optional) — only if the user mentions a minimum rating
- minimumReviews: number (optional) — only if the user mentions a minimum review count
- requirePhone: boolean — true unless the user says otherwise (default true)
- requireWebsite: boolean — true only if the user explicitly wants businesses that already have a website; false if they want businesses WITHOUT a website or don't mention it
- summary: string — if inScope, one short friendly sentence confirming what you're about to search for, addressing ${operatorName} by name (e.g. "On it, ${operatorName} - looking for plumbers within 15km of home."). If not inScope, the redirect described above.

Respond with JSON only, no prose.`
}

export async function parseSearchIntent(text: string): Promise<ParsedSearchIntent | null> {
  const profile = await getOperatorProfile()
  const operatorName = profile.firstName || "there"
  const homeLocation = profile.homeLocation || "Sydney NSW, Australia"

  const result = await chatJson<Partial<ParsedSearchIntent>>(buildSystemPrompt(operatorName, homeLocation), text)
  if (!result) return null

  if (result.inScope === false || !result.categories?.length) {
    return {
      categories: [],
      location: homeLocation,
      radiusKm: 35,
      maxResults: 50,
      requirePhone: true,
      requireWebsite: false,
      inScope: false,
      summary: result.summary || "That's not really what I'm here for, I just help you find who to call next.",
    }
  }

  return {
    categories: result.categories,
    location: result.location || homeLocation,
    radiusKm: result.radiusKm && result.radiusKm > 0 ? Math.min(result.radiusKm, 500) : 35,
    maxResults: result.maxResults && result.maxResults > 0 ? Math.min(result.maxResults, 200) : 50,
    minimumRating: result.minimumRating,
    minimumReviews: result.minimumReviews,
    requirePhone: result.requirePhone ?? true,
    requireWebsite: result.requireWebsite ?? false,
    inScope: true,
    summary: result.summary || `Searching for ${result.categories.join(", ")} near ${result.location || homeLocation}.`,
  }
}
