/**
 * app/api/onboarding/fill/route.ts — "Fill Paychex blanks" (John, 2026-11-07).
 *
 * GET  → everyone AOS sent to Paychex (has a Paychex worker ID and a send
 *        date), as { employeeKeys }.
 * POST { employeeKeys, apply? } → for each (max 15), read Paychex and say
 *        what's blank that AOS can fill. With apply: true on the live site,
 *        fill it. Previews and local runs never write (same rule as Send).
 * Admins only.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { PaychexConfigError } from "@/lib/paychex/api";
import { requireAdmin } from "@/lib/onboarding/server";
import { LIVE_SEND } from "@/lib/onboarding/send";
import { fillOne, type FillOutcome } from "@/lib/onboarding/fill";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Up to 5 Paychex calls each; keep a request well inside 60 seconds.
const MAX_BATCH = 15;

export async function GET(req: NextRequest) {
  if (!(await requireAdmin(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data, error } = await supabaseAdmin.from("employees").select("employee_key")
    .not("paychex_worker_id", "is", null).not("paychex_invited_at", "is", null)
    .or("is_deleted.is.null,is_deleted.eq.false").order("employee_key").limit(1000);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ live: LIVE_SEND, employeeKeys: (data ?? []).map((r) => r.employee_key) });
}

export async function POST(req: NextRequest) {
  const userId = await requireAdmin(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const keys: string[] = Array.isArray(body?.employeeKeys)
    ? [...new Set<string>(body.employeeKeys.filter((k: unknown) => typeof k === "string"))]
    : [];
  if (!keys.length) return NextResponse.json({ error: "Nobody selected." }, { status: 400 });
  if (keys.length > MAX_BATCH) return NextResponse.json({ error: `At most ${MAX_BATCH} at a time.` }, { status: 400 });
  const live = body?.apply === true && LIVE_SEND;

  try {
    const { data: rows, error } = await supabaseAdmin.from("employees").select("*").in("employee_key", keys);
    if (error) throw new Error(error.message);
    const results: FillOutcome[] = [];
    for (const row of rows ?? []) {
      if (!row.paychex_worker_id) continue;
      results.push(await fillOne(row, userId, live));
    }
    return NextResponse.json({ live, results });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: err instanceof PaychexConfigError ? 503 : 500 });
  }
}
