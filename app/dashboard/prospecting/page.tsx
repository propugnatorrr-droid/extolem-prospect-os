"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { Badge } from "@/components/ui/badge"
import { Phone, Globe, MapPin, Star, Loader2, PhoneCall, Car, CloudSun } from "lucide-react"

const NEARBY_KM = 20 // within this radius, worth a physical drop-in; beyond it, phone only

interface BusinessSourceRow {
  id: string
  source: string
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
  distanceFromHomeKm: number | null
}

interface OperatorContext {
  profile: { firstName: string; fullName: string; homeLocation: string }
  weather: { temperatureC: number; label: string } | null
  localTime: string
}

const ALL_SOURCES = [
  { id: "openstreetmap", label: "OpenStreetMap (free, always on)", free: true },
  { id: "google_maps_apify", label: "Google Maps (Apify — costs credits)", free: false },
  { id: "yellowpages_au", label: "Yellow Pages AU (Apify — costs credits)", free: false },
  { id: "google_search_apify", label: "Google Search (Apify — costs credits)", free: false },
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

  useEffect(() => {
    fetch("/api/operator/context")
      .then((res) => res.json())
      .then(setOperatorContext)
      .catch(() => undefined)
  }, [])

  const toggleSource = (id: string) => {
    setSelectedSources((prev) => (prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]))
  }

  async function runSearch() {
    setLoading(true)
    setError(null)
    setSourceErrors({})
    try {
      const startRes = await fetch("/api/discovery/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          categories: categories.split(",").map((c) => c.trim()).filter(Boolean),
          location,
          radiusKm,
          maxResults,
          requirePhone,
          sources: selectedSources,
        }),
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

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">
            {operatorContext?.profile.firstName ? `${operatorContext.profile.firstName}'s prospecting run` : "Prospecting"}
          </h1>
          <p className="text-sm text-zinc-400">Find real businesses near you to call. Discovery only — audits and opportunity scoring land in the next build phase.</p>
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
            <p key={source} className="text-xs text-yellow-500">{source}: {msg}</p>
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
                <div key={b.id} className="flex items-start justify-between p-3 rounded-lg border border-white/10 hover:bg-white/5">
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
                        {b.distanceFromHomeKm}km — {b.distanceFromHomeKm <= NEARBY_KM ? "drive by" : "call only"}
                      </Badge>
                    )}
                    <div className="flex gap-1">
                      {b.sources.map((s) => (
                        <Badge key={s.id} variant="outline" className="text-[10px]">{s.source}</Badge>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
