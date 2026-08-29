// ABN Lookup (Australian Business Register) — free, needs a self-service GUID.
// Get one instantly at https://abr.business.gov.au/Tools/WebServices (no approval wait).
// Uses the JSON search-by-name endpoint since we usually have a name, not an ABN yet.
const ABN_SEARCH_URL = "https://abr.business.gov.au/json/MatchingNames.aspx"

export interface AbnMatch {
  abn: string
  name: string
  state?: string
  postcode?: string
  isCurrent: boolean
  score: number
}

export function isAbnLookupConfigured(): boolean {
  return Boolean(process.env.ABR_GUID)
}

/** JSONP-style endpoint — strips the callback wrapper manually. */
export async function searchAbnByName(name: string, postcode?: string): Promise<AbnMatch[]> {
  const guid = process.env.ABR_GUID
  if (!guid) return []

  const params = new URLSearchParams({
    name,
    guid,
    legalName: "y",
    tradingName: "y",
    maxResults: "5",
  })
  if (postcode) params.set("postcode", postcode)

  const res = await fetch(`${ABN_SEARCH_URL}?${params.toString()}`, { signal: AbortSignal.timeout(8000) })
  if (!res.ok) return []

  const text = await res.text()
  const jsonText = text.replace(/^callback\(/, "").replace(/\)$/, "")

  try {
    const data = JSON.parse(jsonText) as {
      Names?: Array<{ Abn: string; Name: string; State?: string; Postcode?: string; IsCurrent: string; Score: number }>
    }
    return (data.Names || []).map((n) => ({
      abn: n.Abn,
      name: n.Name,
      state: n.State,
      postcode: n.Postcode,
      isCurrent: n.IsCurrent === "Y",
      score: n.Score,
    }))
  } catch {
    return []
  }
}
