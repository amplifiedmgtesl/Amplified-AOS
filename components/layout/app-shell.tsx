
"use client";

import type { ReactNode } from "react";
import Link from "next/link";

const nav = [
  ["/dashboard", "🏠", "Dashboard"],
  ["/master-calendar", "🗓️", "Master Calendar"],
  ["/quote-builder", "🧾", "Quote Builder"],
  ["/invoices", "💵", "Invoices"],
  ["/rate-card", "📋", "Rate Card"],
  ["/job-sheets", "📑", "Job Sheets"],
  ["/timekeeping", "⏱️", "Timekeeping"],
  ["/job-costing", "📈", "Job Costing"],
  ["/employee-directory", "👥", "Employee Directory"],
  ["/job-requests", "📨", "Job Requests"],
  ["/call-sheets", "📞", "Call Sheets"],
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
