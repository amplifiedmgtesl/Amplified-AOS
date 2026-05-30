"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { supabase } from "@/lib/supabase/client";

const nav = [
  ["/lead/job-sheets", "📑", "Job Sheets"],
  ["/lead/timekeeping", "⏱️", "Timekeeping"],
  ["/lead/employees", "👥", "Employees"],
] as const;

export default function LeadLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    async function guard() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { window.location.href = "/login"; return; }

      const { data: profile } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .single();

      if (!profile || profile.role !== "crew_leader") {
        await supabase.auth.signOut();
        window.location.href = "/login";
        return;
      }

      setChecking(false);
    }
    guard();
  }, []);

  async function handleSignOut() {
    await supabase.auth.signOut();
    window.location.href = "/login";
  }

  if (checking) {
    return (
      <div style={{ minHeight: "100vh", display: "grid", placeItems: "center" }}>
        <p className="muted">Loading…</p>
      </div>
    );
  }

  return (
    <div className="layout">
      <aside className="sidebar">
        <div style={{ textAlign: "center", marginBottom: 20 }}>
          <img src="/branding/client-logo.png" alt="Amplified Logo" className="sidebar-logo" />
          <div className="brand-sub">Crew Leader</div>
        </div>

        <div style={{ height: 12 }} />

        {nav.map(([href, icon, label]) => (
          <Link
            key={href}
            href={href}
            className={`nav-link${pathname === href ? " active" : ""}`}
          >
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
        {children}
      </main>
    </div>
  );
}
