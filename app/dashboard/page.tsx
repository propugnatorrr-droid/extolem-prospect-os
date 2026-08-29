"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Building2, Search, Target, CheckCircle2, PhoneCall } from "lucide-react"
import Link from "next/link"

interface Stats {
  businessCount: number
  searchRunCount: number
  opportunityCount: number
  auditedCount: number
  recentBusinesses: Array<{ id: string; name: string; suburb: string | null; category: string | null; createdAt: string }>
  topOffers: Array<{ offer: string; count: number }>
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

export default function DashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null)

  useEffect(() => {
    fetch("/api/stats").then((r) => r.json()).then(setStats).catch(() => undefined)
  }, [])

  const cards = [
    { label: "Businesses found", value: stats?.businessCount ?? "—", icon: Building2, color: "text-blue-400" },
    { label: "Searches run", value: stats?.searchRunCount ?? "—", icon: Search, color: "text-purple-400" },
    { label: "Businesses audited", value: stats?.auditedCount ?? "—", icon: CheckCircle2, color: "text-emerald-400" },
    { label: "Opportunities found", value: stats?.opportunityCount ?? "—", icon: Target, color: "text-orange-400" },
  ]

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Overview</h1>
          <p className="text-zinc-400 text-sm mt-1">Real numbers from your prospecting activity — nothing here is simulated.</p>
        </div>
        <Link href="/dashboard/prospecting">
          <Button size="sm">
            <PhoneCall className="w-4 h-4 mr-2" /> Go prospecting
          </Button>
        </Link>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map((stat) => (
          <Card key={stat.label}>
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-zinc-400 text-sm">{stat.label}</span>
                <stat.icon className={`w-4 h-4 ${stat.color}`} />
              </div>
              <div className="text-2xl font-bold">{stat.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Recently discovered</CardTitle>
          </CardHeader>
          <CardContent>
            {stats && stats.recentBusinesses.length === 0 && (
              <p className="text-sm text-zinc-500">No businesses yet — run a search in Prospecting.</p>
            )}
            <div className="space-y-2">
              {stats?.recentBusinesses.map((b) => (
                <div key={b.id} className="flex items-center justify-between text-sm p-2 rounded-lg hover:bg-white/5">
                  <span>{b.name}</span>
                  <span className="text-xs text-zinc-500">{[b.category, b.suburb].filter(Boolean).join(" · ")}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Top opportunities across your leads</CardTitle>
          </CardHeader>
          <CardContent>
            {stats && stats.topOffers.length === 0 && (
              <p className="text-sm text-zinc-500">No audits run yet — audit a business from Prospecting to see what it's missing.</p>
            )}
            <div className="space-y-3">
              {stats?.topOffers.map((o) => (
                <div key={o.offer}>
                  <div className="flex items-center justify-between text-sm mb-1">
                    <span>{OFFER_LABELS[o.offer] || o.offer}</span>
                    <span className="text-zinc-400">{o.count}</span>
                  </div>
                  <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-blue-500 to-emerald-500 rounded-full"
                      style={{ width: `${Math.min(100, (o.count / Math.max(...stats.topOffers.map((x) => x.count))) * 100)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
