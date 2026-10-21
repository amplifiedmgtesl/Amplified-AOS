/**
 * app/api/onboarding/paychex/route.ts — the Paychex check on the Onboarding
 * screen (backlog #120). Runs every time the page opens, against the Paychex
 * copy in AOS rather than Paychex itself (docs/paychex-snapshot-plan.md).
 *
 * POST { keys: string[] } → for each of these AOS people, every Paychex
 * worker who looks like them (email, phone, name, or the worker AOS sent).
 * Clear matches (see clearMatch in lib/onboarding/plan.ts) get their
 * Payroll ID straight away and come back in `linked` — no click needed
 * (John, 2026-10-20). Everything else is only shown. Admins only.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { fetchPaychexWorker, PaychexConfigError } from "@/lib/paychex/api";
import { loadSnapshot, lookupWorkers, needsLiveRead, saveWorker } from "@/lib/paychex/snapshot";
import { clearMatch, findDuplicates, paychexMatches, type PaychexMatch } from "@/lib/onboarding/plan";
import { loadLiveEmployees, loadNotSame, loadTakenPayrollIds, requireAdmin, toOnbEmployee } from "@/lib/onboarding/server";
import { linkPaychexId } from "@/lib/onboarding/link";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const userId = await requireAdmin(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const keys: string[] = Array.isArray(body?.keys) ? body.keys.filter((k: unknown) => typeof k === "string").slice(0, 500) : [];
  if (!keys.length) return NextResponse.json({ matches: {}, linked: [] });
  try {
    const people = [];
    for (let i = 0; i < keys.length; i += 200) {
      const { data, error } = await supabaseAdmin.from("employees").select("*").in("employee_key", keys.slice(i, i + 200));
      if (error) throw new Error(error.message);
      people.push(...(data ?? []).map(toOnbEmployee));
    }
    // The Paychex copy in AOS, not Paychex (docs/paychex-snapshot-plan.md).
    const [snap, live, notSame, taken] = await Promise.all([
      loadSnapshot(), loadLiveEmployees(), loadNotSame(), loadTakenPayrollIds(),
    ]);
    if (!snap.at) return NextResponse.json({ error: "No copy of Paychex yet. Click Update from Paychex." }, { status: 409 });
    const byId = new Map(lookupWorkers(snap).map((w) => [w.workerId, w]));
    // People AOS sent and still waiting for a Payroll ID: one live call each,
    // by worker ID, so a finished onboarding links without a full refresh.
    // At most once an hour per person, however often the page is opened.
    for (const p of people) {
      if (p.paychexWorkerId && p.payrollId == null && needsLiveRead(snap, p.paychexWorkerId)) {
        const w = await fetchPaychexWorker(p.paychexWorkerId);
        if (w) { byId.set(w.workerId, w); await saveWorker(w, true); }
      }
    }
    const workers = [...byId.values()];

    const matches: Record<string, PaychexMatch[]> = {};
    const linked: { employeeKey: string; name: string; payrollId: number; paychexName: string }[] = [];
    const runId = `onb-auto-${Date.now()}`;
    for (const p of people) {
      const m = paychexMatches(p, workers);
      const clear = clearMatch(p, m, (id) => byId.get(id), findDuplicates(p, live, notSame), taken);
      if (clear?.payrollId != null) {
        const r = await linkPaychexId(p.employeeKey, byId.get(clear.workerId)!, userId, runId);
        if ("payrollId" in r) {
          taken.add(r.payrollId);
          linked.push({ employeeKey: p.employeeKey, name: p.name, payrollId: r.payrollId, paychexName: clear.name });
          continue;
        }
      }
      matches[p.employeeKey] = m;
    }
    return NextResponse.json({ matches, linked, checkedAt: snap.at });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: e instanceof PaychexConfigError ? 503 : 500 });
  }
}
