/**
 * app/api/onboarding/send/route.ts — "Send to Paychex" (backlog #120).
 *
 * POST { employeeKeys: string[], ignoreMatches? } → send each person to
 * Paychex (see lib/onboarding/send.ts). Paychex is read once for the
 * look-alike check. Anyone Paychex may already have comes back as
 * needsConfirm and is NOT sent; ignoreMatches is honoured for a single
 * person only, after the admin has seen the matches. Admins only.
 */

import { NextRequest, NextResponse } from "next/server";
import { PaychexConfigError } from "@/lib/paychex/api";
import { loadSnapshot, lookupWorkers, pullSnapshot, SEND_MAX_AGE_MS, snapshotAt } from "@/lib/paychex/snapshot";
import { requireAdmin } from "@/lib/onboarding/server";
import { LIVE_SEND, sendOne, type SendOutcome } from "@/lib/onboarding/send";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Each send is one Paychex call plus a read-back; keep a request well
// inside the 60-second limit. The screen sends bigger batches in chunks.
const MAX_BATCH = 15;

export async function POST(req: NextRequest) {
  const userId = await requireAdmin(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const keys: string[] = Array.isArray(body?.employeeKeys)
    ? [...new Set<string>(body.employeeKeys.filter((k: unknown) => typeof k === "string"))]
    : [];
  if (!keys.length) return NextResponse.json({ error: "Nobody selected." }, { status: 400 });
  if (keys.length > MAX_BATCH) return NextResponse.json({ error: `At most ${MAX_BATCH} at a time.` }, { status: 400 });
  const skipCheck = body?.ignoreMatches === true && keys.length === 1;

  try {
    let workers = null;
    if (!skipCheck) {
      // The look-alike check reads the Paychex copy in AOS. If it's over an
      // hour old (someone went to lunch mid-onboarding), Paychex is re-read
      // first; within the hour the copy is trusted (John, 2026-10-20).
      const at = await snapshotAt();
      if (!at || Date.now() - new Date(at).getTime() > SEND_MAX_AGE_MS) await pullSnapshot("send", userId);
      workers = lookupWorkers(await loadSnapshot());
    }
    const results: SendOutcome[] = [];
    for (const k of keys) results.push(await sendOne(k, userId, workers));
    return NextResponse.json({ live: LIVE_SEND, results });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: err instanceof PaychexConfigError ? 503 : 500 });
  }
}
