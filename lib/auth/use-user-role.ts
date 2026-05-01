"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";

// Returns the current user's profile.role, or null while loading / if not
// signed in. Components that need to gate UI by role read this once on mount.
// Any page wrapped in <AppShell> already has admin-vs-crew_leader routing
// enforced; this hook is for finer-grained per-button gating.
export function useUserRole(): string | null {
  const [role, setRole] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (cancelled || !user) return;
      const { data } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .single();
      if (cancelled) return;
      setRole(data?.role ?? null);
    })();
    return () => { cancelled = true; };
  }, []);

  return role;
}
