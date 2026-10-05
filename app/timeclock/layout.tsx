"use client";

// Time Clock kiosk shell. Runs under the initiating user's session (the crew
// leader opens it on a shared on-site device). Access is limited to crew_leader
// and admin; workers are NOT logged in — they are names on the roster and assert
// identity by tapping their row + signing. Full-screen, no admin sidebar.

import { useEffect, useState, type ReactNode } from "react";
import { supabase } from "@/lib/supabase/client";
import { canUseTimeclock } from "@/lib/timeclock/open";

export default function TimeclockLayout({ children }: { children: ReactNode }) {
  const [checking, setChecking] = useState(true);
  const [denied, setDenied] = useState(false);

  useEffect(() => {
    async function guard() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { window.location.href = "/login"; return; }

      const { data: profile } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .single();

      // Other roles get a message, not a sign-out: they reach this page from
      // inside a working AOS session and must not lose it.
      setDenied(!canUseTimeclock(profile?.role));
      setChecking(false);
    }
    guard();
  }, []);

  if (checking) {
    return (
      <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "#0f172a", color: "#94a3b8", fontFamily: "system-ui, sans-serif" }}>
        Loading Time Clock…
      </div>
    );
  }

  if (denied) {
    return (
      <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "#0f172a", color: "#94a3b8", fontFamily: "system-ui, sans-serif", padding: 16, textAlign: "center" }}>
        <div>
          <div style={{ color: "#f1f5f9", fontSize: 18, marginBottom: 12 }}>The Time Clock is for crew leaders and admins.</div>
          <a href="/dashboard" style={{ color: "#94a3b8" }}>Back to AOS</a>
        </div>
      </div>
    );
  }

  return <div style={{ minHeight: "100vh", background: "#0f172a" }}>{children}</div>;
}
