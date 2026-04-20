"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase/client";

const nav = [
  ["/dashboard", "🏠", "Dashboard"],
  ["/master-calendar", "🗓️", "Master Calendar"],
  ["/quote-builder", "🧾", "Quote Builder"],
  ["/invoices", "💵", "Invoices"],
  ["/rate-card", "📋", "Rate Card"],
  ["/job-sheets", "📑", "Job Sheets"],
  ["/timekeeping", "⏱️", "Timekeeping"],
  ["/job-costing", "📈", "Job Costing"],
  ["/clients", "🏢", "Clients"],
  ["/employee-directory", "👥", "Employee Directory"],
  ["/job-requests", "📨", "Job Requests"],
  ["/call-sheets", "📞", "Call Sheets"],
  ["/maintenance", "⚙️", "Maintenance"],
] as const;

export function AppShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  async function handleSignOut() {
    await supabase.auth.signOut();
    window.location.href = "/login";
  }

  return (
    <div className="layout">
      <aside className="sidebar">
        <div style={{ textAlign: "center", marginBottom: 20 }}>
          <img src="/branding/client-logo.png" alt="Amplified Logo" className="sidebar-logo" />
          <div className="brand-sub">Operations Suite</div>
        </div>

        <div style={{ height: 12 }} />

        {nav.map(([href, icon, label]) => (
          <Link key={href} href={href} className="nav-link">
            <span style={{ fontSize: 18, marginRight: 10 }}>{icon}</span>
            {label}
          </Link>
        ))}

        <div style={{ marginTop: "auto", paddingTop: 24 }}>
          <button
            onClick={handleSignOut}
            style={{ width: "100%", background: "transparent", border: "1px solid #555", color: "#999", borderRadius: 6, padding: "8px 12px", cursor: "pointer", fontSize: 13 }}
          >
            Sign out
          </button>
        </div>
      </aside>

      <main className="main">
        <div className="topbar">
          <img src="/branding/client-logo.png" alt="Logo" className="header-logo" />
          <div>
            <h1 className="page-title">{title}</h1>
            {subtitle ? <div className="page-subtitle">{subtitle}</div> : null}
          </div>
        </div>

        {children}
      </main>
    </div>
  );
}
