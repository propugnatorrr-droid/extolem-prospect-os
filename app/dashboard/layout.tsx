"use client"

import Link from "next/link"
import { useRouter, usePathname } from "next/navigation"
import { cn } from "@/lib/utils"
import { LayoutDashboard, ChevronLeft, Menu, PhoneCall, LogOut, Users } from "lucide-react"
import { useState } from "react"

const navItems = [
  { href: "/dashboard", icon: LayoutDashboard, label: "Overview" },
  { href: "/dashboard/prospecting", icon: PhoneCall, label: "Prospecting" },
  { href: "/dashboard/leads", icon: Users, label: "Leads" },
]

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const [collapsed, setCollapsed] = useState(false)

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" })
    router.push("/login")
    router.refresh()
  }

  return (
    <div className="flex h-screen bg-black">
      {/* Sidebar */}
      <div className={cn(
        "flex flex-col border-r border-white/10 bg-[#050505] transition-all duration-300",
        collapsed ? "w-16" : "w-60"
      )}>
        {/* Logo */}
        <div className="h-14 border-b border-white/10 flex items-center px-4 gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-emerald-500 flex items-center justify-center font-bold text-sm flex-shrink-0">
            E
          </div>
          {!collapsed && <span className="font-bold text-lg">Extolem ProspectOS</span>}
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="ml-auto text-zinc-400 hover:text-white transition"
          >
            {collapsed ? <Menu className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-2 space-y-1 overflow-y-auto">
          {navItems.map((item) => {
            const isActive = pathname === item.href || (item.href !== "/dashboard" && pathname.startsWith(item.href))
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition",
                  isActive
                    ? "bg-white/10 text-white"
                    : "text-zinc-400 hover:bg-white/5 hover:text-white"
                )}
              >
                <item.icon className="w-4 h-4 flex-shrink-0" />
                {!collapsed && <span>{item.label}</span>}
              </Link>
            )
          })}
        </nav>

        <div className="p-2 border-t border-white/10">
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-zinc-400 hover:bg-white/5 hover:text-white transition"
          >
            <LogOut className="w-4 h-4 flex-shrink-0" />
            {!collapsed && <span>Log out</span>}
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="p-6">
          {children}
        </div>
      </div>
    </div>
  )
}
