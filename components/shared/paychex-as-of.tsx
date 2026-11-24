"use client";

// "Paychex as of <when> · Update from Paychex" (docs/paychex-snapshot-plan.md).
// Screens read a copy of Paychex kept in AOS; this shows how old it is and
// re-reads Paychex on request (~525 calls, about a minute). Admins only.
//
// Only one read of Paychex runs at a time (John, 11/24), never queued: while
// one is running — started here, by someone else, by Send to Paychex or by
// the Monday schedule — the button is greyed out, and so is Send on
// Onboarding (onReadingChange). The server refuses a second read with 409.

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase/client";

export function fmtWhen(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/** Tell every Paychex-as-of on the page that a read is running (e.g. Send got a 409). */
export const PAYCHEX_READING_EVENT = "paychex-reading";
export function announcePaychexReading() {
  window.dispatchEvent(new Event(PAYCHEX_READING_EVENT));
}

async function call(step: string) {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(`/api/paychex/snapshot?step=${step}`, { method: "POST", headers: { Authorization: `Bearer ${session?.access_token ?? ""}` } });
  return { res, json: await res.json().catch(() => ({} as any)) };
}

const POLL_MS = 5000;

export default function PaychexAsOf({ at, onRefreshed, onReadingChange }: {
  at: string | null | undefined;
  onRefreshed: () => void;
  onReadingChange?: (reading: boolean) => void;
}) {
  const [busy, setBusy] = useState("");          // this screen's own refresh
  const [elsewhere, setElsewhere] = useState(false); // a read started somewhere else
  const polling = useRef(false);
  const alive = useRef(true);
  const refreshedRef = useRef(onRefreshed);
  refreshedRef.current = onRefreshed;

  // Wait for a running read to finish, then reload the screen.
  const watch = useCallback(async () => {
    if (polling.current) return;
    polling.current = true;
    setElsewhere(true);
    try {
      for (;;) {
        await new Promise((r) => setTimeout(r, POLL_MS));
        if (!alive.current) return;
        const { res, json } = await call("status");
        if (!res.ok || !json?.running) break;
      }
    } finally {
      polling.current = false;
      if (alive.current) { setElsewhere(false); refreshedRef.current(); }
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    call("status").then(({ res, json }) => { if (res.ok && json?.running) watch(); }).catch(() => {});
    const onEvent = () => { watch(); };
    window.addEventListener(PAYCHEX_READING_EVENT, onEvent);
    return () => { alive.current = false; window.removeEventListener(PAYCHEX_READING_EVENT, onEvent); };
  }, [watch]);

  const reading = !!busy || elsewhere;
  useEffect(() => { onReadingChange?.(reading); }, [reading, onReadingChange]);

  async function refresh() {
    // Two steps, like the Monday run: read Paychex, then apply its changes.
    for (const step of ["pull", "process"]) {
      setBusy(step === "pull" ? "Reading Paychex…" : "Applying changes…");
      const { res, json } = await call(step);
      if (res.status === 409 && json?.busy) { setBusy(""); watch(); return; }
      if (!res.ok) { setBusy(""); alert(json?.error ?? `Refresh failed (HTTP ${res.status})`); onRefreshed(); return; }
    }
    setBusy("");
    onRefreshed();
  }

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12 }}>
      <span className="muted" title="AOS keeps a copy of Paychex, refreshed every Monday night">
        {busy || (elsewhere ? "Reading Paychex…" : at ? `Paychex as of ${fmtWhen(at)}` : "No copy of Paychex yet")}
      </span>
      <button className="secondary" style={{ padding: "4px 8px", fontSize: 12, borderRadius: 8 }} disabled={reading} onClick={refresh}
        title={reading ? "Paychex is being read — this comes back when it's done" : "Read Paychex again now (about a minute) and apply its changes"}>
        Update from Paychex
      </button>
    </span>
  );
}
