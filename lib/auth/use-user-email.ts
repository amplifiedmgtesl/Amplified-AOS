"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";

/** Returns the signed-in user's email, or null while loading / signed out.
 *  Used for owner-only UI gating (recovery buttons, debug actions). */
export function useUserEmail(): string | null {
  const [email, setEmail] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (cancelled) return;
      setEmail(user?.email ?? null);
    })();
    return () => { cancelled = true; };
  }, []);
  return email;
}
