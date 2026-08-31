"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import {
  Bot,
  BriefcaseBusiness,
  Car,
  ChevronDown,
  ChevronUp,
  Clock3,
  ExternalLink,
  Globe,
  Loader2,
  MapPin,
  Phone,
  PhoneCall,
  Radar,
  Search,
  Sparkles,
  Star,
  WandSparkles,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

const NEARBY_KM = 20

const OFFER_LABELS: Record<string, string> = {
  website_rebuild: "Website opportunity",
  website_optimisation: "Website upgrade",
  seo: "SEO opportunity",
  ai_chatbot: "AI chatbot",
  ai_receptionist: "AI receptionist",
  missed_call_recovery: "Missed-call recovery",
  review_automation: "Review automation",
  online_booking: "Online booking",
  lead_followup_automation: "Lead follow-up",
  erp_opportunity: "Operations automation",
}

const SEARCH_MESSAGES = [
  "Scanning the market around your target area",
  "Building a clean list of real businesses",
  "Matching contact and location signals",
  "Removing duplicates and weak results",
  "Preparing your highest-value prospects",
  "Finishing your call-ready list",
]

interface OpportunityRow {
  id: string
  offer: string
  score: number
  confidence: number
  reasons: string
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
  opportunities: OpportunityRow[]
  distanceFromHomeKm: number | null
}

interface OperatorContext {
  profile: {
    firstName: string
    fullName: string
    homeLocation: string
  }
  weather: {
    temperatureC: number
    label: string
  } | null
  localTime: string
}

interface SearchStatus {
  searchRunId: string
  status: "starting" | "running" | "completed" | "failed"
  resultCount: number
  completedSources: number
  totalSources: number
}

interface SearchParameters {
  categories: string[]
  location: string
  radiusKm: number
  maxResults: number
  minimumRating?: number
  minimumReviews?: number
  requirePhone: boolean
  requireWebsite: boolean
}

function safeWebsite(url: string): string {
  if (url.startsWith("http://") || url.startsWith("https://")) {
    return url
  }

  return `https://${url}`
}

function SearchProgress({
  status,
  seconds,
}: {
  status: SearchStatus | null
  seconds: number
}) {
  const stage = Math.min(
    SEARCH_MESSAGES.length - 1,
    Math.floor(seconds / 12),
  )

  const sourceProgress =
    status && status.totalSources > 0
      ? status.completedSources / status.totalSources
      : 0

  const timeProgress = Math.min(0.88, seconds / 110)
  const progress = Math.max(0.08, sourceProgress, timeProgress)

  return (
    <Card className="overflow-hidden border-blue-500/20 bg-gradient-to-br from-blue-950/30 via-zinc-950 to-cyan-950/20">
      <CardContent className="p-0">
        <div className="relative flex min-h-[260px] flex-col items-center justify-center overflow-hidden px-6 py-10">
          <div className="absolute inset-0 opacity-30">
            <div className="absolute left-1/2 top-1/2 h-72 w-72 -translate-x-1/2 -translate-y-1/2 rounded-full border border-blue-400/20 animate-ping" />
            <div className="absolute left-1/2 top-1/2 h-52 w-52 -translate-x-1/2 -translate-y-1/2 rounded-full border border-cyan-400/20" />
            <div className="absolute left-1/2 top-1/2 h-36 w-36 -translate-x-1/2 -translate-y-1/2 rounded-full border border-blue-300/20" />
          </div>

          <div className="relative mb-5 flex h-20 w-20 items-center justify-center rounded-full border border-blue-400/30 bg-blue-500/10 shadow-[0_0_60px_rgba(59,130,246,0.25)]">
            <Radar className="h-10 w-10 animate-pulse text-blue-300" />
          </div>

          <div className="relative text-center">
            <div className="mb-2 flex items-center justify-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin text-blue-400" />
              <h3 className="font-semibold text-white">
                Extolem AI is working
              </h3>
            </div>

            <p className="min-h-6 text-sm text-zinc-300">
              {SEARCH_MESSAGES[stage]}
            </p>

            <div className="mx-auto mt-6 h-1.5 w-72 max-w-full overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-gradient-to-r from-blue-500 via-cyan-400 to-blue-400 transition-all duration-1000"
                style={{
                  width: `${Math.round(progress * 100)}%`,
                }}
              />
            </div>

            <div className="mt-4 flex items-center justify-center gap-5 text-xs text-zinc-500">
              <span className="flex items-center gap-1">
                <Clock3 className="h-3.5 w-3.5" />
                {seconds}s
              </span>

              <span className="flex items-center gap-1">
                <BriefcaseBusiness className="h-3.5 w-3.5" />
                {status?.resultCount || 0} matched
              </span>
            </div>

            <p className="mt-5 text-xs text-zinc-500">
              You can leave this page open. Results will appear automatically.
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

export default function ProspectingPage() {
  const [categories, setCategories] = useState("plumber")
  const [location, setLocation] = useState("Penrith NSW")
  const [radiusKm, setRadiusKm] = useState(35)
  const [maxResults, setMaxResults] = useState(50)
  const [requirePhone, setRequirePhone] = useState(true)
  const [requireWebsite, setRequireWebsite] = useState(false)

  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [parsing, setParsing] = useState(false)
  const [searchRunId, setSearchRunId] = useState<string | null>(null)
  const [searchStatus, setSearchStatus] = useState<SearchStatus | null>(null)
  const [elapsedSeconds, setElapsedSeconds] = useState(0)

  const [businesses, setBusinesses] = useState<Business[]>([])
  const [error, setError] = useState<string | null>(null)
  const [operatorContext, setOperatorContext] =
    useState<OperatorContext | null>(null)

  const [auditingId, setAuditingId] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [nlQuery, setNlQuery] = useState("")
  const [assistantMessage, setAssistantMessage] = useState<string | null>(
    null,
  )

  const pollingRef = useRef(false)

  useEffect(() => {
    fetch("/api/operator/context", { cache: "no-store" })
      .then((response) => response.json())
      .then(setOperatorContext)
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    if (!loading) return

    const timer = window.setInterval(() => {
      setElapsedSeconds((current) => current + 1)
    }, 1000)

    return () => window.clearInterval(timer)
  }, [loading])

  const loadBusinesses = useCallback(async (runId: string) => {
    const response = await fetch(
      `/api/discovery?searchRunId=${encodeURIComponent(runId)}`,
      { cache: "no-store" },
    )

    if (!response.ok) return

    const data = await response.json()
    setBusinesses(data.businesses || [])
  }, [])

  const checkStatus = useCallback(
    async (runId: string) => {
      if (pollingRef.current) return

      pollingRef.current = true

      try {
        const response = await fetch(
          `/api/discovery/status/${encodeURIComponent(runId)}`,
          { cache: "no-store" },
        )

        const data = await response.json()

        if (!response.ok) {
          throw new Error(data.error || "Could not check search status.")
        }

        const status = data as SearchStatus
        setSearchStatus(status)

        if (status.resultCount > 0) {
          await loadBusinesses(runId)
        }

        if (status.status === "completed") {
          setLoading(false)
          setAssistantMessage(
            status.resultCount > 0
              ? `Your call list is ready. I found ${status.resultCount} businesses worth reviewing.`
              : "The search finished, but I couldn't find a strong match. Try a nearby suburb or a broader category.",
          )
          return
        }

        if (status.status === "failed") {
          setLoading(false)
          setError(
            "That search did not return usable results. Try again with a broader location.",
          )
          return
        }

        window.setTimeout(() => {
          void checkStatus(runId)
        }, 3500)
      } catch (pollError) {
        console.error(pollError)

        window.setTimeout(() => {
          void checkStatus(runId)
        }, 5000)
      } finally {
        pollingRef.current = false
      }
    },
    [loadBusinesses],
  )

  async function startDiscovery(params: SearchParameters) {
    setLoading(true)
    setError(null)
    setBusinesses([])
    setElapsedSeconds(0)
    setSearchStatus(null)
    setAssistantMessage(
      `I’m building a prospect list for ${params.categories.join(
        ", ",
      )} around ${params.location}.`,
    )

    try {
      const response = await fetch("/api/discovery/start", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(params),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || "Search could not be started.")
      }

      setSearchRunId(data.searchRunId)

      window.setTimeout(() => {
        void checkStatus(data.searchRunId)
      }, 1200)
    } catch (startError) {
      setLoading(false)
      setError(
        startError instanceof Error
          ? startError.message
          : "Search could not be started.",
      )
    }
  }

  async function runAssistant() {
    const text = nlQuery.trim()
    if (!text || loading || parsing) return

    setParsing(true)
    setError(null)
    setAssistantMessage(null)

    try {
      const response = await fetch("/api/discovery/parse", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ text }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || "I couldn't understand that.")
      }

      setAssistantMessage(data.summary)

      if (data.mode !== "search") return

      setCategories(data.categories.join(", "))
      setLocation(data.location)
      setRadiusKm(data.radiusKm)
      setMaxResults(data.maxResults)
      setRequirePhone(data.requirePhone)
      setRequireWebsite(data.requireWebsite)

      await startDiscovery({
        categories: data.categories,
        location: data.location,
        radiusKm: data.radiusKm,
        maxResults: data.maxResults,
        minimumRating: data.minimumRating,
        minimumReviews: data.minimumReviews,
        requirePhone: data.requirePhone,
        requireWebsite: data.requireWebsite,
      })
    } catch (assistantError) {
      setError(
        assistantError instanceof Error
          ? assistantError.message
          : "I couldn't process that request.",
      )
    } finally {
      setParsing(false)
    }
  }

  async function runManualSearch() {
    const parsedCategories = categories
      .split(",")
      .map((category) => category.trim())
      .filter(Boolean)

    if (!parsedCategories.length || !location.trim()) {
      setError("Enter a business type and location.")
      return
    }

    await startDiscovery({
      categories: parsedCategories,
      location: location.trim(),
      radiusKm,
      maxResults,
      requirePhone,
      requireWebsite,
    })
  }

  async function runAudit(businessId: string) {
    setAuditingId(businessId)
    setError(null)

    try {
      const response = await fetch("/api/audit", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ businessId }),
      })

      const data = await response.json().catch(() => ({}))

      if (!response.ok) {
        throw new Error(data.error || "Audit failed.")
      }

      if (searchRunId) {
        await loadBusinesses(searchRunId)
      }

      setExpandedId(businessId)
    } catch (auditError) {
      setError(
        auditError instanceof Error
          ? auditError.message
          : "Audit failed.",
      )
    } finally {
      setAuditingId(null)
    }
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6 pb-16">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-start">
        <div>
          <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.2em] text-blue-400">
            <Bot className="h-4 w-4" />
            Extolem Prospect Intelligence
          </div>

          <h1 className="text-3xl font-bold tracking-tight">
            {operatorContext?.profile.firstName
              ? `Good to see you, ${operatorContext.profile.firstName}.`
              : "Your prospecting command centre"}
          </h1>

          <p className="mt-2 max-w-2xl text-sm text-zinc-400">
            Tell Extolem AI what kind of businesses you want. Your call
            list will be researched, cleaned and prioritised automatically.
          </p>
        </div>

        {operatorContext && (
          <div className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-right text-xs text-zinc-400">
            <div>{operatorContext.localTime}</div>
            <div>{operatorContext.profile.homeLocation}</div>
            {operatorContext.weather && (
              <div className="mt-1 text-zinc-500">
                {operatorContext.weather.temperatureC}°C ·{" "}
                {operatorContext.weather.label}
              </div>
            )}
          </div>
        )}
      </div>

      <Card className="border-blue-500/20 bg-gradient-to-br from-blue-950/20 via-zinc-950 to-zinc-950">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <WandSparkles className="h-4 w-4 text-blue-400" />
            What should I find for you?
          </CardTitle>
        </CardHeader>

        <CardContent className="space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              value={nlQuery}
              onChange={(event) => setNlQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  void runAssistant()
                }
              }}
              disabled={loading || parsing}
              className="h-12 flex-1 border-white/10 bg-black/30 text-base"
              placeholder="Find hotels near Sydney with weak websites and a phone number"
            />

            <Button
              onClick={runAssistant}
              disabled={!nlQuery.trim() || loading || parsing}
              className="h-12 px-6"
            >
              {parsing ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="mr-2 h-4 w-4" />
              )}
              Ask Extolem
            </Button>
          </div>

          {assistantMessage && (
            <div className="flex items-start gap-3 rounded-xl border border-blue-500/15 bg-blue-500/[0.06] p-4">
              <Bot className="mt-0.5 h-5 w-5 shrink-0 text-blue-400" />
              <p className="text-sm text-zinc-300">
                {assistantMessage}
              </p>
            </div>
          )}

          <button
            type="button"
            onClick={() => setAdvancedOpen((current) => !current)}
            className="flex items-center gap-2 text-xs text-zinc-500 transition hover:text-zinc-300"
          >
            {advancedOpen ? (
              <ChevronUp className="h-3.5 w-3.5" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5" />
            )}
            Fine-tune search
          </button>

          {advancedOpen && (
            <div className="space-y-4 rounded-xl border border-white/10 bg-black/20 p-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <Label>Business types</Label>
                  <Input
                    value={categories}
                    onChange={(event) =>
                      setCategories(event.target.value)
                    }
                    placeholder="plumber, electrician"
                  />
                </div>

                <div>
                  <Label>Location</Label>
                  <Input
                    value={location}
                    onChange={(event) =>
                      setLocation(event.target.value)
                    }
                    placeholder="Penrith NSW"
                  />
                </div>

                <div>
                  <Label>Radius</Label>
                  <Input
                    type="number"
                    min={1}
                    max={500}
                    value={radiusKm}
                    onChange={(event) =>
                      setRadiusKm(Number(event.target.value))
                    }
                  />
                </div>

                <div>
                  <Label>Maximum results</Label>
                  <Input
                    type="number"
                    min={1}
                    max={500}
                    value={maxResults}
                    onChange={(event) =>
                      setMaxResults(Number(event.target.value))
                    }
                  />
                </div>
              </div>

              <div className="flex flex-wrap gap-5">
                <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-300">
                  <Checkbox
                    checked={requirePhone}
                    onCheckedChange={(value) =>
                      setRequirePhone(Boolean(value))
                    }
                  />
                  Must have a phone number
                </label>

                <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-300">
                  <Checkbox
                    checked={requireWebsite}
                    onCheckedChange={(value) =>
                      setRequireWebsite(Boolean(value))
                    }
                  />
                  Must have a website
                </label>
              </div>

              <Button
                onClick={runManualSearch}
                disabled={loading}
              >
                {loading ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Search className="mr-2 h-4 w-4" />
                )}
                Build my call list
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {loading && (
        <SearchProgress
          status={searchStatus}
          seconds={elapsedSeconds}
        />
      )}

      {error && (
        <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-300">
          {error}
        </div>
      )}

      {businesses.length > 0 && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-lg">
                Your call list
              </CardTitle>
              <p className="mt-1 text-sm text-zinc-500">
                {businesses.length} businesses found and cleaned
              </p>
            </div>

            <Badge className="bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/15">
              Ready
            </Badge>
          </CardHeader>

          <CardContent>
            <div className="space-y-3">
              {businesses.map((business, index) => (
                <div
                  key={business.id}
                  className="rounded-xl border border-white/10 bg-white/[0.025] p-4 transition hover:border-blue-500/30 hover:bg-blue-500/[0.04]"
                >
                  <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-blue-500/10 text-xs font-semibold text-blue-300">
                          {index + 1}
                        </span>

                        <h3 className="font-semibold">
                          {business.name}
                        </h3>

                        {business.category && (
                          <Badge variant="secondary">
                            {business.category}
                          </Badge>
                        )}
                      </div>

                      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-xs text-zinc-400">
                        {business.phone && (
                          <a
                            href={`tel:${business.phone}`}
                            className="flex items-center gap-1.5 transition hover:text-blue-300"
                          >
                            <Phone className="h-3.5 w-3.5" />
                            {business.phone}
                          </a>
                        )}

                        {business.website && (
                          <a
                            href={safeWebsite(business.website)}
                            target="_blank"
                            rel="noreferrer"
                            className="flex max-w-xs items-center gap-1.5 truncate transition hover:text-blue-300"
                          >
                            <Globe className="h-3.5 w-3.5 shrink-0" />
                            <span className="truncate">
                              {business.website}
                            </span>
                            <ExternalLink className="h-3 w-3 shrink-0" />
                          </a>
                        )}

                        {(business.suburb ||
                          business.state ||
                          business.postcode) && (
                          <span className="flex items-center gap-1.5">
                            <MapPin className="h-3.5 w-3.5" />
                            {[
                              business.suburb,
                              business.state,
                              business.postcode,
                            ]
                              .filter(Boolean)
                              .join(", ")}
                          </span>
                        )}

                        {business.rating != null && (
                          <span className="flex items-center gap-1.5">
                            <Star className="h-3.5 w-3.5 text-amber-400" />
                            {business.rating.toFixed(1)} ·{" "}
                            {business.reviewCount || 0} reviews
                          </span>
                        )}
                      </div>

                      {business.opportunities.length > 0 && (
                        <div className="mt-3">
                          <div className="flex flex-wrap gap-1.5">
                            {business.opportunities
                              .sort((a, b) => b.score - a.score)
                              .map((opportunity) => (
                                <button
                                  key={opportunity.id}
                                  type="button"
                                  onClick={() =>
                                    setExpandedId(
                                      expandedId === business.id
                                        ? null
                                        : business.id,
                                    )
                                  }
                                >
                                  <Badge
                                    variant="outline"
                                    className="cursor-pointer border-blue-500/20 text-blue-300 hover:bg-blue-500/10"
                                  >
                                    {OFFER_LABELS[
                                      opportunity.offer
                                    ] || opportunity.offer}
                                    <span className="ml-1 opacity-60">
                                      {opportunity.score}
                                    </span>
                                  </Badge>
                                </button>
                              ))}
                          </div>

                          {expandedId === business.id && (
                            <div className="mt-3 rounded-lg border border-white/10 bg-black/20 p-3">
                              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
                                Why this business is worth calling
                              </p>

                              <ul className="space-y-1.5 text-xs text-zinc-300">
                                {business.opportunities.flatMap(
                                  (opportunity) => {
                                    try {
                                      const reasons = JSON.parse(
                                        opportunity.reasons,
                                      ) as string[]

                                      return reasons.map(
                                        (reason, reasonIndex) => (
                                          <li
                                            key={`${opportunity.id}-${reasonIndex}`}
                                            className="flex gap-2"
                                          >
                                            <span className="text-blue-400">
                                              •
                                            </span>
                                            {reason}
                                          </li>
                                        ),
                                      )
                                    } catch {
                                      return []
                                    }
                                  },
                                )}
                              </ul>
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    <div className="flex shrink-0 flex-wrap items-center gap-2">
                      {business.distanceFromHomeKm != null && (
                        <Badge
                          variant="outline"
                          className="flex items-center gap-1.5"
                        >
                          {business.distanceFromHomeKm <=
                          NEARBY_KM ? (
                            <Car className="h-3.5 w-3.5" />
                          ) : (
                            <Phone className="h-3.5 w-3.5" />
                          )}
                          {business.distanceFromHomeKm} km
                        </Badge>
                      )}

                      {business.phone && (
                        <Button size="sm" asChild>
                          <a href={`tel:${business.phone}`}>
                            <PhoneCall className="mr-2 h-4 w-4" />
                            Call
                          </a>
                        </Button>
                      )}

                      <Button
                        size="sm"
                        variant="outline"
                        disabled={auditingId === business.id}
                        onClick={() =>
                          void runAudit(business.id)
                        }
                      >
                        {auditingId === business.id ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <Sparkles className="mr-2 h-4 w-4" />
                        )}
                        {business.opportunities.length
                          ? "Refresh insight"
                          : "Analyse"}
                      </Button>
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
