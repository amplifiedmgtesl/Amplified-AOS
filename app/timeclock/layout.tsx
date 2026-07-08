"use client";

// Time Clock kiosk shell. Runs under the initiating user's session (the crew
// leader opens it on a shared on-site device). Access is limited to crew_leader
// and admin; workers are NOT logged in — they are names on the roster and assert
// identity by tapping their row + signing. Full-screen, no admin sidebar.

import { useEffect, useState, type ReactNode } from "react";
import { supabase } from "@/lib/supabase/client";

export default function TimeclockLayout({ children }: { children: ReactNode }) {
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

      const role = profile?.role;
      if (role !== "crew_leader" && role !== "admin") {
        await supabase.auth.signOut();
        window.location.href = "/login";
        return;
      }
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

  return <div style={{ minHeight: "100vh", background: "#0f172a" }}>{children}</div>;
}
