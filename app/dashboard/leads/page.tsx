"use client"

import { useEffect, useMemo, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import {
  Phone, Globe, MapPin, Star, Car, ChevronDown, ChevronUp, Search, X, Users, Bookmark, PhoneCall as PhoneCallIcon, CheckCircle2, Ban,
} from "lucide-react"

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

const STATUSES = [
  { id: "new", label: "New", icon: Users },
  { id: "saved", label: "Saved", icon: Bookmark },
  { id: "contacted", label: "Contacted", icon: PhoneCallIcon },
  { id: "qualified", label: "Qualified", icon: CheckCircle2 },
  { id: "not_interested", label: "Not interested", icon: X },
  { id: "do_not_contact", label: "Do not contact", icon: Ban },
] as const

const SORT_OPTIONS = [
  { id: "distance", label: "Nearest first" },
  { id: "rating", label: "Highest rated" },
  { id: "newest", label: "Newest found" },
  { id: "name", label: "Name (A-Z)" },
] as const

const NEARBY_KM = 20

interface Run {
  id: string
  query: string
  location: string
  radiusKm: number | null
  status: string
  resultCount: number
  createdAt: string
}

interface Business {
  id: string
  name: string
  category: string | null
  phone: string | null
  website: string | null
  suburb: string | null
  state: string | null
  postcode: string | null
  rating: number | null
  reviewCount: number | null
  status: string
  notes: string | null
  searchRunId: string | null
  createdAt: string
  sources: Array<{ id: string; source: string }>
  opportunities: Array<{ id: string; offer: string; score: number; reasons: string }>
  distanceFromHomeKm: number | null
}

function websiteHref(url: string): string {
  return url.startsWith("http") ? url : `https://${url}`
}

export default function LeadsPage() {
  const [businesses, setBusinesses] = useState<Business[]>([])
  const [runs, setRuns] = useState<Run[]>([])
  const [statusFilter, setStatusFilter] = useState<string>("all")
  const [runFilter, setRunFilter] = useState<string>("all")
  const [categoryFilter, setCategoryFilter] = useState<string>("all")
  const [distanceFilter, setDistanceFilter] = useState<string>("all")
  const [sortBy, setSortBy] = useState<string>("distance")
  const [searchText, setSearchText] = useState("")
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [notesDraft, setNotesDraft] = useState<Record<string, string>>({})
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)

  async function load() {
    setLoading(true)
    const [bizRes, runsRes] = await Promise.all([
      fetch("/api/discovery"),
      fetch("/api/discovery/runs"),
    ])
    const bizData = await bizRes.json()
    const runsData = await runsRes.json()
    setBusinesses(bizData.businesses || [])
    setRuns(runsData.runs || [])
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [])

  const categories = useMemo(() => {
    const set = new Set<string>()
    for (const b of businesses) if (b.category) set.add(b.category)
    return Array.from(set).sort()
  }, [businesses])

  const statusCounts = useMemo(() => {
    const c: Record<string, number> = { all: businesses.length }
    for (const s of STATUSES) c[s.id] = businesses.filter((b) => b.status === s.id).length
    return c
  }, [businesses])

  const filtered = useMemo(() => {
    let result = businesses.filter((b) => {
      if (statusFilter !== "all" && b.status !== statusFilter) return false
      if (runFilter !== "all" && b.searchRunId !== runFilter) return false
      if (categoryFilter !== "all" && b.category !== categoryFilter) return false
      if (distanceFilter === "near" && (b.distanceFromHomeKm == null || b.distanceFromHomeKm > NEARBY_KM)) return false
      if (distanceFilter === "far" && (b.distanceFromHomeKm == null || b.distanceFromHomeKm <= NEARBY_KM)) return false
      if (searchText.trim()) {
        const q = searchText.toLowerCase()
        const haystack = [b.name, b.phone, b.website, b.suburb, b.category].filter(Boolean).join(" ").toLowerCase()
        if (!haystack.includes(q)) return false
      }
      return true
    })

    result = [...result].sort((a, b) => {
      switch (sortBy) {
        case "rating":
          return (b.rating ?? 0) - (a.rating ?? 0)
        case "newest":
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        case "name":
          return a.name.localeCompare(b.name)
        default:
          return (a.distanceFromHomeKm ?? Infinity) - (b.distanceFromHomeKm ?? Infinity)
      }
    })

    return result
  }, [businesses, statusFilter, runFilter, categoryFilter, distanceFilter, searchText, sortBy])

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleSelectAll() {
    setSelected((prev) => (prev.size === filtered.length ? new Set() : new Set(filtered.map((b) => b.id))))
  }

  async function updateStatus(businessId: string, status: string) {
    setBusinesses((prev) => prev.map((b) => (b.id === businessId ? { ...b, status } : b)))
    await fetch(`/api/discovery/business/${businessId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    })
  }

  async function bulkUpdateStatus(status: string) {
    const ids = Array.from(selected)
    setBusinesses((prev) => prev.map((b) => (ids.includes(b.id) ? { ...b, status } : b)))
    await Promise.all(
      ids.map((id) =>
        fetch(`/api/discovery/business/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status }),
        }),
      ),
    )
    setSelected(new Set())
  }

  async function saveNotes(businessId: string) {
    const notes = notesDraft[businessId] ?? ""
    setBusinesses((prev) => prev.map((b) => (b.id === businessId ? { ...b, notes } : b)))
    await fetch(`/api/discovery/business/${businessId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notes }),
    })
  }

  const hasFilters = statusFilter !== "all" || runFilter !== "all" || categoryFilter !== "all" || distanceFilter !== "all" || searchText.trim()

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Leads</h1>
        <p className="text-sm text-zinc-400">Every business you've found, across every search, in one place.</p>
      </div>

      {/* Status tabs */}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant={statusFilter === "all" ? "default" : "outline"} onClick={() => setStatusFilter("all")}>
          All ({statusCounts.all})
        </Button>
        {STATUSES.map((s) => (
          <Button key={s.id} size="sm" variant={statusFilter === s.id ? "default" : "outline"} onClick={() => setStatusFilter(s.id)}>
            <s.icon className="w-3.5 h-3.5 mr-1.5" />
            {s.label} ({statusCounts[s.id] || 0})
          </Button>
        ))}
      </div>

      {/* Search + filters */}
      <Card>
        <CardContent className="pt-6 space-y-3">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
            <Input
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder="Search by name, phone, website, or suburb..."
              className="pl-9"
            />
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger><SelectValue placeholder="Category" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All categories</SelectItem>
                {categories.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>

            <Select value={distanceFilter} onValueChange={setDistanceFilter}>
              <SelectTrigger><SelectValue placeholder="Distance" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Any distance</SelectItem>
                <SelectItem value="near">Nearby (drive by)</SelectItem>
                <SelectItem value="far">Far (call only)</SelectItem>
              </SelectContent>
            </Select>

            <Select value={runFilter} onValueChange={setRunFilter}>
              <SelectTrigger><SelectValue placeholder="Search run" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All runs</SelectItem>
                {runs.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.query} in {r.location} ({r.resultCount})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={sortBy} onValueChange={setSortBy}>
              <SelectTrigger><SelectValue placeholder="Sort by" /></SelectTrigger>
              <SelectContent>
                {SORT_OPTIONS.map((o) => <SelectItem key={o.id} value={o.id}>{o.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {hasFilters && (
            <Button
              size="sm"
              variant="ghost"
              className="text-zinc-400"
              onClick={() => {
                setStatusFilter("all"); setRunFilter("all"); setCategoryFilter("all"); setDistanceFilter("all"); setSearchText("")
              }}
            >
              <X className="w-3.5 h-3.5 mr-1" /> Clear filters
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Bulk actions */}
      {selected.size > 0 && (
        <Card className="border-blue-500/40">
          <CardContent className="pt-6 flex flex-wrap items-center gap-2">
            <span className="text-sm text-zinc-300">{selected.size} selected</span>
            {STATUSES.map((s) => (
              <Button key={s.id} size="sm" variant="outline" onClick={() => bulkUpdateStatus(s.id)}>
                Mark {s.label.toLowerCase()}
              </Button>
            ))}
            <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setSelected(new Set())}>
              Clear selection
            </Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">{filtered.length} leads</CardTitle>
          {filtered.length > 0 && (
            <label className="flex items-center gap-2 text-xs text-zinc-400 cursor-pointer">
              <Checkbox checked={selected.size === filtered.length} onCheckedChange={toggleSelectAll} />
              Select all
            </label>
          )}
        </CardHeader>
        <CardContent>
          {loading && <p className="text-sm text-zinc-500">Loading...</p>}
          {!loading && filtered.length === 0 && (
            <p className="text-sm text-zinc-500">
              {hasFilters ? "Nothing matches these filters." : "Nothing here yet. Run a search in Prospecting."}
            </p>
          )}
          <div className="space-y-2">
            {filtered.map((b) => {
              const isExpanded = expandedId === b.id
              return (
                <div key={b.id} className="p-3 rounded-lg border border-white/10">
                  <div className="flex items-start gap-3">
                    <Checkbox checked={selected.has(b.id)} onCheckedChange={() => toggleSelect(b.id)} className="mt-1" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium">{b.name}</span>
                            {b.category && <Badge variant="secondary">{b.category}</Badge>}
                            {b.distanceFromHomeKm != null && (
                              <Badge variant={b.distanceFromHomeKm <= NEARBY_KM ? "default" : "outline"} className="text-[10px] flex items-center gap-1">
                                <Car className="w-3 h-3" />
                                {b.distanceFromHomeKm}km
                              </Badge>
                            )}
                          </div>
                          <div className="flex flex-wrap items-center gap-4 mt-1 text-xs text-zinc-400">
                            {b.phone && (
                              <a href={`tel:${b.phone}`} className="flex items-center gap-1 hover:text-blue-400">
                                <Phone className="w-3 h-3" />{b.phone}
                              </a>
                            )}
                            {b.website && (
                              <a href={websiteHref(b.website)} target="_blank" rel="noreferrer" className="flex items-center gap-1 hover:text-blue-400 truncate max-w-[220px]">
                                <Globe className="w-3 h-3" />{b.website}
                              </a>
                            )}
                            {(b.suburb || b.postcode) && (
                              <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{[b.suburb, b.state, b.postcode].filter(Boolean).join(", ")}</span>
                            )}
                            {b.rating && <span className="flex items-center gap-1"><Star className="w-3 h-3" />{b.rating} ({b.reviewCount ?? 0})</span>}
                          </div>
                          {b.opportunities.length > 0 && (
                            <div className="flex flex-wrap gap-1.5 mt-2">
                              {b.opportunities.map((o) => (
                                <Badge key={o.id} variant="outline" className="text-[10px]">{OFFER_LABELS[o.offer] || o.offer} · {o.score}</Badge>
                              ))}
                            </div>
                          )}
                        </div>
                        <Button size="sm" variant="ghost" onClick={() => setExpandedId(isExpanded ? null : b.id)}>
                          {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                        </Button>
                      </div>

                      <div className="flex flex-wrap gap-1.5 mt-3 pt-3 border-t border-white/5">
                        {STATUSES.map((s) => (
                          <Button
                            key={s.id}
                            size="sm"
                            variant={b.status === s.id ? "default" : "outline"}
                            className="h-6 text-[11px]"
                            onClick={() => updateStatus(b.id, s.id)}
                          >
                            {s.label}
                          </Button>
                        ))}
                      </div>

                      {isExpanded && (
                        <div className="mt-3 pt-3 border-t border-white/5 space-y-3">
                          {b.opportunities.length > 0 && (
                            <ul className="space-y-1 text-xs text-zinc-400 list-disc list-inside">
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
                          <div className="flex gap-1">
                            {b.sources.map((s) => (
                              <Badge key={s.id} variant="outline" className="text-[10px]">{SOURCE_LABELS[s.source] || s.source}</Badge>
                            ))}
                          </div>
                          <div>
                            <Textarea
                              placeholder="Call notes..."
                              value={notesDraft[b.id] ?? b.notes ?? ""}
                              onChange={(e) => setNotesDraft((prev) => ({ ...prev, [b.id]: e.target.value }))}
                              className="text-sm"
                            />
                            <Button size="sm" className="mt-2" onClick={() => saveNotes(b.id)}>
                              Save notes
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
