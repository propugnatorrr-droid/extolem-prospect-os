"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { Badge } from "@/components/ui/badge"
import { Phone, Globe, MapPin, Star, Loader2, PhoneCall, Car, CloudSun, Search as SearchIcon, Sparkles } from "lucide-react"

const NEARBY_KM = 20 // within this radius, worth a physical drop-in; beyond it, phone only

const SOURCE_LABELS: Record<string, string> = {
  openstreetmap: "Map data",
  google_maps_apify: "Google Maps",
  yellowpages_au: "Yellow Pages",
  google_search_apify: "Web search",
}

const OFFER_LABELS: Record<string, string> = {
  website_rebuild: "Needs a website",
  website_optimisation: "Website needs work",
  seo: "SEO gaps",
  ai_chatbot: "No chatbot",
  ai_receptionist: "AI receptionist fit",
  missed_call_recovery: "Missed-call recovery",
  review_automation: "Review automation",
  online_booking: "No online booking",
  lead_followup_automation: "Lead follow-up gap",
  erp_opportunity: "Disconnected systems",
}

interface BusinessSourceRow {
  id: string
  source: string
}

interface OpportunityRow {
  id: string
  offer: string
  score: number
  confidence: number
  reasons: string // JSON string
}

interface Business {
  id: string
  name: string
  category: string | null
  phone: string | null
  website: string | null
  street: string | null
  suburb: string | null
  state: string | null
  postcode: string | null
  rating: number | null
  reviewCount: number | null
  status: string
  sources: BusinessSourceRow[]
  opportunities: OpportunityRow[]
  distanceFromHomeKm: number | null
}

interface OperatorContext {
  profile: { firstName: string; fullName: string; homeLocation: string }
  weather: { temperatureC: number; label: string } | null
  localTime: string
}

const ALL_SOURCES = [
  { id: "openstreetmap", label: "Map data" },
  { id: "google_maps_apify", label: "Google Maps" },
  { id: "yellowpages_au", label: "Yellow Pages" },
  { id: "google_search_apify", label: "Web search" },
] as const

export default function ProspectingPage() {
  const [categories, setCategories] = useState("plumber")
  const [location, setLocation] = useState("Penrith NSW")
  const [radiusKm, setRadiusKm] = useState(35)
  const [maxResults, setMaxResults] = useState(50)
  const [requirePhone, setRequirePhone] = useState(true)
  const [selectedSources, setSelectedSources] = useState<string[]>(["openstreetmap"])
  const [loading, setLoading] = useState(false)
  const [businesses, setBusinesses] = useState<Business[]>([])
  const [sourceErrors, setSourceErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [operatorContext, setOperatorContext] = useState<OperatorContext | null>(null)
  const [auditingId, setAuditingId] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [nlQuery, setNlQuery] = useState("")
  const [parsing, setParsing] = useState(false)
  const [parseSummary, setParseSummary] = useState<string | null>(null)
  const [parseMode, setParseMode] = useState<string | null>(null)

  useEffect(() => {
    fetch("/api/operator/context")
      .then((res) => res.json())
      .then(setOperatorContext)
      .catch(() => undefined)
  }, [])

  const toggleSource = (id: string) => {
    setSelectedSources((prev) => (prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]))
  }

  async function startDiscovery(params: {
    categories: string[]
    location: string
    radiusKm: number
    maxResults: number
    requirePhone: boolean
    sources: string[]
  }) {
    setLoading(true)
    setError(null)
    setSourceErrors({})
    try {
      const startRes = await fetch("/api/discovery/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
      })
      const startData = await startRes.json()
      if (!startRes.ok) throw new Error(startData.error || "Search failed")
      setSourceErrors(startData.sourceErrors || {})

      const listRes = await fetch(`/api/discovery?searchRunId=${startData.searchRunId}`)
      const listData = await listRes.json()
      setBusinesses(listData.businesses || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong")
    } finally {
      setLoading(false)
    }
  }

  async function runParse() {
    if (!nlQuery.trim()) return
    setParsing(true)
    setParseSummary(null)
    setParseMode(null)
    setError(null)
    try {
      const res = await fetch("/api/discovery/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: nlQuery }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Could not understand that.")
      setParseSummary(data.summary)
      setParseMode(data.mode)
      if (data.mode === "search") {
        setCategories(data.categories.join(", "))
        setLocation(data.location)
        setRadiusKm(data.radiusKm)
        setMaxResults(data.maxResults)
        setRequirePhone(data.requirePhone)
        // Run immediately with the parsed values rather than waiting on state
        // (setState above hasn't landed yet in this closure) or making Manav
        // click a second button after already describing what he wants.
        await startDiscovery({
          categories: data.categories,
          location: data.location,
          radiusKm: data.radiusKm,
          maxResults: data.maxResults,
          requirePhone: data.requirePhone,
          sources: selectedSources,
        })
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong")
    } finally {
      setParsing(false)
    }
  }

  function runSearch() {
    return startDiscovery({
      categories: categories.split(",").map((c) => c.trim()).filter(Boolean),
      location,
      radiusKm,
      maxResults,
      requirePhone,
      sources: selectedSources,
    })
  }

  async function runAudit(businessId: string) {
    setAuditingId(businessId)
    try {
      await fetch("/api/audit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessId }),
      })
      await refreshBusiness(businessId)
      setExpandedId(businessId)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Audit failed")
    } finally {
      setAuditingId(null)
    }
  }

  async function refreshBusiness(businessId: string) {
    const res = await fetch(`/api/discovery/business/${businessId}`)
    if (!res.ok) return
    const data = await res.json()
    setBusinesses((prev) => prev.map((b) => (b.id === businessId ? { ...b, ...data.business } : b)))
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">
            {operatorContext?.profile.firstName ? `${operatorContext.profile.firstName}'s prospecting run` : "Prospecting"}
          </h1>
          <p className="text-sm text-zinc-400">Find real businesses near you, audit their site, and see what they're missing before you call.</p>
        </div>
        {operatorContext && (
          <div className="text-right text-xs text-zinc-400 space-y-0.5">
            <div>{operatorContext.localTime} · {operatorContext.profile.homeLocation}</div>
            {operatorContext.weather && (
              <div className="flex items-center justify-end gap-1">
                <CloudSun className="w-3 h-3" />
                {operatorContext.weather.temperatureC}°C, {operatorContext.weather.label}
              </div>
            )}
          </div>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-blue-400" /> Just tell me what you're after
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Input
              value={nlQuery}
              onChange={(e) => setNlQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && runParse()}
              placeholder="e.g. find me plumbers nearby with no website, or roofers an hour away"
            />
            <Button onClick={runParse} disabled={parsing || !nlQuery.trim()}>
              {parsing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            </Button>
          </div>
          {parseSummary && (
            <p className={`text-sm ${parseMode === "search" ? "text-emerald-400" : parseMode === "refuse" ? "text-yellow-500" : "text-blue-400"}`}>
              {parseSummary}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Search</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label>Categories (comma separated)</Label>
              <Input value={categories} onChange={(e) => setCategories(e.target.value)} placeholder="plumber, emergency plumber" />
            </div>
            <div>
              <Label>Location</Label>
              <Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Penrith NSW" />
            </div>
            <div>
              <Label>Radius (km)</Label>
              <Input type="number" value={radiusKm} onChange={(e) => setRadiusKm(Number(e.target.value))} />
            </div>
            <div>
              <Label>Max results</Label>
              <Input type="number" value={maxResults} onChange={(e) => setMaxResults(Number(e.target.value))} />
            </div>
          </div>

          <div>
            <Label className="mb-2 block">Sources</Label>
            <div className="space-y-2">
              {ALL_SOURCES.map((s) => (
                <div key={s.id} className="flex items-center gap-2">
                  <Checkbox checked={selectedSources.includes(s.id)} onCheckedChange={() => toggleSource(s.id)} />
                  <span className="text-sm text-zinc-300">{s.label}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Checkbox checked={requirePhone} onCheckedChange={(v) => setRequirePhone(Boolean(v))} />
            <span className="text-sm text-zinc-300">Require phone number</span>
          </div>

          <Button onClick={runSearch} disabled={loading || selectedSources.length === 0}>
            {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <PhoneCall className="w-4 h-4 mr-2" />}
            {loading ? "Searching..." : "Find businesses to call"}
          </Button>

          {error && <p className="text-sm text-red-400">{error}</p>}
          {Object.entries(sourceErrors).map(([source, msg]) => (
            <p key={source} className="text-xs text-yellow-500">{SOURCE_LABELS[source] || source}: {msg}</p>
          ))}
        </CardContent>
      </Card>

      {businesses.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{businesses.length} businesses</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {businesses.map((b) => (
                <div key={b.id} className="p-3 rounded-lg border border-white/10 hover:bg-white/5">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{b.name}</span>
                        {b.category && <Badge variant="secondary">{b.category}</Badge>}
                      </div>
                      <div className="flex flex-wrap items-center gap-4 mt-1 text-xs text-zinc-400">
                        {b.phone && <span className="flex items-center gap-1"><Phone className="w-3 h-3" />{b.phone}</span>}
                        {b.website && <span className="flex items-center gap-1"><Globe className="w-3 h-3" />{b.website}</span>}
                        {(b.suburb || b.postcode) && (
                          <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{[b.suburb, b.state, b.postcode].filter(Boolean).join(", ")}</span>
                        )}
                        {b.rating && (
                          <span className="flex items-center gap-1"><Star className="w-3 h-3" />{b.rating} ({b.reviewCount ?? 0})</span>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      {b.distanceFromHomeKm != null && (
                        <Badge
                          variant={b.distanceFromHomeKm <= NEARBY_KM ? "default" : "outline"}
                          className="text-[10px] flex items-center gap-1"
                        >
                          {b.distanceFromHomeKm <= NEARBY_KM ? <Car className="w-3 h-3" /> : <Phone className="w-3 h-3" />}
                          {b.distanceFromHomeKm}km, {b.distanceFromHomeKm <= NEARBY_KM ? "drive by" : "call only"}
                        </Badge>
                      )}
                      <div className="flex gap-1">
                        {b.sources.map((s) => (
                          <Badge key={s.id} variant="outline" className="text-[10px]">{SOURCE_LABELS[s.source] || s.source}</Badge>
                        ))}
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-6 text-[11px] mt-1"
                        disabled={auditingId === b.id}
                        onClick={() => runAudit(b.id)}
                      >
                        {auditingId === b.id ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <SearchIcon className="w-3 h-3 mr-1" />}
                        {b.opportunities.length ? "Re-audit" : "Audit"}
                      </Button>
                    </div>
                  </div>

                  {b.opportunities.length > 0 && (
                    <div className="mt-2 pt-2 border-t border-white/5">
                      <div className="flex flex-wrap gap-1.5">
                        {b.opportunities.map((o) => (
                          <Badge
                            key={o.id}
                            variant={expandedId === b.id ? "default" : "outline"}
                            className="text-[10px] cursor-pointer"
                            onClick={() => setExpandedId(expandedId === b.id ? null : b.id)}
                          >
                            {OFFER_LABELS[o.offer] || o.offer} · {o.score}
                          </Badge>
                        ))}
                      </div>
                      {expandedId === b.id && (
                        <ul className="mt-2 space-y-1 text-xs text-zinc-400 list-disc list-inside">
                          {b.opportunities.flatMap((o) => {
                            let reasons: string[] = []
                            try {
                              reasons = JSON.parse(o.reasons)
                            } catch {
                              reasons = []
                            }
                            return reasons.map((r, i) => <li key={`${o.id}-${i}`}>{r}</li>)
                          })}
                        </ul>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
