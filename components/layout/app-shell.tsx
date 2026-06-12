"use client";

import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { supabase } from "@/lib/supabase/client";

// Order roughly follows the lifecycle: see what's happening (Dashboard,
// Calendar) → who you're working with (Clients) → the work itself (Jobs) →
// pricing (Quotes, Invoices, Rate Card) → execution (Timekeeping)
// → review/finance (Timesheet Review, Job Costing) → roster + admin.
// "/job-requests" route is kept as-is for now (rename to /jobs is part of
// Phase B in the system rewrite); only the label says "Jobs".
// Job Sheets + Call Sheets were decommissioned 2026-06-11 (routes and
// components removed). The job_sheets/job_sheet_workers tables are kept
// as inert history — legacy timesheet entries point at them.
const nav = [
  ["/dashboard", "🏠", "Dashboard"],
  ["/master-calendar", "🗓️", "Calendar"],
  ["/clients", "🏢", "Clients"],
  ["/job-requests", "📨", "Jobs"],
  ["/quotes", "🧾", "Quotes"],
  ["/invoices", "💵", "Invoices"],
  ["/rate-card", "📋", "Rate Card"],
  ["/timekeeping", "⏱️", "Timekeeping"],
  ["/timekeeping/review", "✅", "Timesheet Review"],
  ["/payroll", "💰", "Payroll"],
  ["/job-costing", "📈", "Job Costing"],
  ["/employee-directory", "👥", "Employees"],
  ["/maintenance", "⚙️", "Maintenance"],
] as const;

const STORAGE_KEY = "aos.sidebar.collapsed";
const SHOW_IDS_KEY = "aos.showIds";

export function AppShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState<boolean>(false);
  const [authChecking, setAuthChecking] = useState<boolean>(true);
  const [userRole, setUserRole] = useState<string | null>(null);
  // Admin debug toggle: when on, .record-id chips on rows reveal record
  // GUIDs. Default off — zero clutter for normal use. Persisted to
  // localStorage so the choice survives a reload. Body class drives the
  // CSS rule in globals.css (`body.show-ids .record-id { display: ...; }`).
  const [showIds, setShowIds] = useState<boolean>(false);

  // Role guard. Crew leaders must never see the admin shell — its nav
  // exposes the full app (Quotes, Invoices, Rate Card, Employees with
  // pay info, etc.). Reaching any admin URL (even by clicking a stray
  // link from /lead/) bounces them back to their crew-leader home.
  useEffect(() => {
    let cancelled = false;
    async function guard() {
      const { data: { user } } = await supabase.auth.getUser();
      if (cancelled) return;
      if (!user) { window.location.href = "/login"; return; }

      const { data: profile } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .single();
      if (cancelled) return;

      if (profile?.role === "crew_leader") {
        window.location.href = "/lead/timekeeping";
        return;
      }

      // Payroll role: confined to /payroll/* and /employee-directory.
      // Employee directory access is required for the Rippling Emp No
      // field and for setting pay rates per employee/specialty —
      // payroll owns both of those, so we let them through. Clients,
      // jobs, pricing, etc. remain out of reach.
      if (profile?.role === "payroll") {
        const allowed = pathname?.startsWith("/payroll")
          || pathname?.startsWith("/employee-directory");
        if (!allowed) {
          window.location.href = "/payroll";
          return;
        }
      }

      setUserRole(profile?.role ?? null);
      setAuthChecking(false);
    }
    guard();
    return () => { cancelled = true; };
  }, [pathname]);

  // Load persisted preferences (skipped during SSR to avoid hydration mismatch)
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw === "1") setCollapsed(true);
      const ids = localStorage.getItem(SHOW_IDS_KEY);
      if (ids === "1") {
        setShowIds(true);
        document.body.classList.add("show-ids");
      }
    } catch { /* ignore */ }
  }, []);

  function toggleCollapsed() {
    const next = !collapsed;
    setCollapsed(next);
    try { localStorage.setItem(STORAGE_KEY, next ? "1" : "0"); } catch { /* ignore */ }
  }
  function toggleShowIds() {
    const next = !showIds;
    setShowIds(next);
    try { localStorage.setItem(SHOW_IDS_KEY, next ? "1" : "0"); } catch { /* ignore */ }
    document.body.classList.toggle("show-ids", next);
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
    window.location.href = "/login";
  }

  // Block render until we know the user is not a crew_leader. Renders
  // nothing identifying so a page-load flash can't leak admin nav or
  // page content to a crew leader.
  if (authChecking) {
    return (
      <div style={{ minHeight: "100vh", display: "grid", placeItems: "center" }}>
        <p className="muted">Loading…</p>
      </div>
    );
  }

  const visibleNav = userRole === "payroll"
    ? nav.filter(([href]) => href === "/payroll" || href === "/employee-directory")
    : nav;
  const brandSub = userRole === "payroll" ? "Payroll" : "Operations Suite";

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
              <div className="brand-sub">{brandSub}</div>
            </>
          )}
        </div>

        <div style={{ height: 12 }} />

        {visibleNav.map(([href, icon, label]) => (
          <Link key={href} href={href} className="nav-link" title={collapsed ? label : undefined}>
            <span style={{ fontSize: 18, marginRight: collapsed ? 0 : 10 }}>{icon}</span>
            {!collapsed && label}
          </Link>
        ))}

        <div style={{ marginTop: "auto", paddingTop: 24 }}>
          {/* Admin debug toggle — reveal record IDs across all screens.
              Useful for referencing specific rows during data cleanup
              conversations. Off by default. */}
          <button
            onClick={toggleShowIds}
            title={collapsed ? (showIds ? "Hide record IDs" : "Show record IDs") : undefined}
            style={{ width: "100%", background: showIds ? "#3a3a2a" : "transparent", border: "1px solid #555", color: "#999", borderRadius: 6, padding: "6px 10px", cursor: "pointer", fontSize: 11, marginBottom: 8 }}
          >
            {collapsed ? "🆔" : (showIds ? "🆔 IDs: on" : "🆔 Show IDs")}
          </button>
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
