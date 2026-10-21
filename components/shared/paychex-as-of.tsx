"use client";

// "Paychex as of <when> · Update from Paychex" (docs/paychex-snapshot-plan.md).
// Screens read a copy of Paychex kept in AOS; this shows how old it is and
// re-reads Paychex on request (~155 calls, about 30 seconds). Admins only.

import { useState } from "react";
import { supabase } from "@/lib/supabase/client";

export function fmtWhen(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export default function PaychexAsOf({ at, onRefreshed }: { at: string | null | undefined; onRefreshed: () => void }) {
  const [busy, setBusy] = useState("");

  async function refresh() {
    const { data: { session } } = await supabase.auth.getSession();
    // Two steps, like the Monday run: read Paychex, then apply its changes.
    for (const step of ["pull", "process"]) {
      setBusy(step === "pull" ? "Reading Paychex…" : "Applying changes…");
      const res = await fetch(`/api/paychex/snapshot?step=${step}`, { method: "POST", headers: { Authorization: `Bearer ${session?.access_token ?? ""}` } });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { setBusy(""); alert(json?.error ?? `Refresh failed (HTTP ${res.status})`); onRefreshed(); return; }
    }
    setBusy("");
    onRefreshed();
  }

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12 }}>
      <span className="muted" title="AOS keeps a copy of Paychex, refreshed every Monday night">
        {busy || (at ? `Paychex as of ${fmtWhen(at)}` : "No copy of Paychex yet")}
      </span>
      <button className="secondary" style={{ padding: "4px 8px", fontSize: 12, borderRadius: 8 }} disabled={!!busy} onClick={refresh}
        title="Read Paychex again now (about 30 seconds) and apply its changes">
        Update from Paychex
      </button>
    </span>
  );
}
