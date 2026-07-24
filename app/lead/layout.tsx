"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { supabase } from "@/lib/supabase/client";

const nav = [
  ["/lead/jobs", "📨", "Jobs"],
  ["/lead/timekeeping", "⏱️", "Timekeeping"],
  ["/lead/employees", "👥", "Employees"],
] as const;

// Matches the mobile breakpoint in globals.css. Below this the sidebar
// becomes an off-canvas drawer toggled by the topbar hamburger. Mirrors
// the admin AppShell — without this the crew-leader sidebar slides
// off-screen on phones with no way to reopen it (the field crews work
// almost entirely on phones).
const MOBILE_QUERY = "(max-width: 960px)";

export default function LeadLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [checking, setChecking] = useState(true);
  // Mobile drawer state — same wiring as AppShell so the shared
  // `.layout.nav-open` CSS slides the sidebar in on phones.
  const [isMobile, setIsMobile] = useState(false);
  const [navOpen, setNavOpen] = useState(false);

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

  // Track the mobile breakpoint so the drawer logic knows which mode we're in.
  useEffect(() => {
    const mq = window.matchMedia(MOBILE_QUERY);
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  // Close the drawer when the route changes (a nav link was followed) or
  // when we grow back to desktop width.
  useEffect(() => { setNavOpen(false); }, [pathname]);
  useEffect(() => { if (!isMobile) setNavOpen(false); }, [isMobile]);

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

  const title = nav.find(([href]) => pathname === href || pathname?.startsWith(href + "/"))?.[2] ?? "Crew Leader";

  return (
    <div className={`layout${navOpen ? " nav-open" : ""}`}>
      <aside className="sidebar">
        {/* Mobile drawer close button (hidden on desktop via CSS). */}
        <button
          type="button"
          className="drawer-close"
          onClick={() => setNavOpen(false)}
          aria-label="Close menu"
        >
          ×
        </button>

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
            onClick={() => setNavOpen(false)}
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

      {/* Dark backdrop behind the open drawer; tap to dismiss. */}
      {navOpen ? <div className="nav-backdrop" onClick={() => setNavOpen(false)} /> : null}

      <main className="main">
        <div className="topbar">
          {/* Hamburger — mobile only (hidden on desktop via CSS). */}
          <button
            type="button"
            className="mobile-menu-btn"
            onClick={() => setNavOpen(true)}
            aria-label="Open menu"
            aria-expanded={navOpen}
          >
            ☰
          </button>
          <img src="/branding/client-logo.png" alt="Logo" className="header-logo" />
          <div>
            <h1 className="page-title">{title}</h1>
          </div>
        </div>

        {children}
      </main>
    </div>
  );
}
