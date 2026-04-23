"use client";

import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase/client";

const nav = [
  ["/dashboard", "🏠", "Dashboard"],
  ["/master-calendar", "🗓️", "Calendar"],
  ["/clients", "🏢", "Clients"],
  ["/quote-builder", "🧾", "Quote Builder"],
  ["/invoices", "💵", "Invoices"],
  ["/rate-card", "📋", "Rate Card"],
  ["/job-sheets", "📑", "Job Sheets"],
  ["/timekeeping", "⏱️", "Timekeeping"],
  ["/job-costing", "📈", "Job Costing"],
  ["/employee-directory", "👥", "Employees"],
  ["/job-requests", "📨", "Job Requests"],
  // ["/call-sheets", "📞", "Call Sheets"],  // Hidden — duplicate of Job Sheets. Code kept under app/call-sheets/ but excluded from nav + analysis.
  ["/maintenance", "⚙️", "Maintenance"],
] as const;

const STORAGE_KEY = "aos.sidebar.collapsed";

export function AppShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  const [collapsed, setCollapsed] = useState<boolean>(false);

  // Load persisted preference (skipped during SSR to avoid hydration mismatch)
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw === "1") setCollapsed(true);
    } catch { /* ignore */ }
  }, []);

  function toggleCollapsed() {
    const next = !collapsed;
    setCollapsed(next);
    try { localStorage.setItem(STORAGE_KEY, next ? "1" : "0"); } catch { /* ignore */ }
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
    window.location.href = "/login";
  }

  return (
    <div className={`layout${collapsed ? " layout-collapsed" : ""}`}>
      <aside className="sidebar">
        <button
          type="button"
          className="sidebar-toggle"
          onClick={toggleCollapsed}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? "›" : "‹"}
        </button>

        <div style={{ textAlign: "center", marginBottom: 20 }}>
          {collapsed ? (
            <div className="sidebar-brand-mini">AES</div>
          ) : (
            <>
              <img src="/branding/client-logo.png" alt="Amplified Logo" className="sidebar-logo" />
              <div className="brand-sub">Operations Suite</div>
            </>
          )}
        </div>

        <div style={{ height: 12 }} />

        {nav.map(([href, icon, label]) => (
          <Link key={href} href={href} className="nav-link" title={collapsed ? label : undefined}>
            <span style={{ fontSize: 18, marginRight: collapsed ? 0 : 10 }}>{icon}</span>
            {!collapsed && label}
          </Link>
        ))}

        <div style={{ marginTop: "auto", paddingTop: 24 }}>
          <button
            onClick={handleSignOut}
            title={collapsed ? "Sign out" : undefined}
            style={{ width: "100%", background: "transparent", border: "1px solid #555", color: "#999", borderRadius: 6, padding: "8px 12px", cursor: "pointer", fontSize: 13 }}
          >
            {collapsed ? "⎋" : "Sign out"}
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
