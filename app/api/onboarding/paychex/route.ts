/**
 * app/api/onboarding/paychex/route.ts — the Paychex check on the Onboarding
 * screen (backlog #120). Runs every time the page opens.
 *
 * POST { keys: string[] } → for each of these AOS people, every Paychex
 * worker who looks like them (email, phone, name, or the worker AOS sent).
 * Clear matches (see clearMatch in lib/onboarding/plan.ts) get their
 * Payroll ID straight away and come back in `linked` — no click needed
 * (John, 2026-10-20). Everything else is only shown. Admins only.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { fetchPaychexWorker, fetchPaychexWorkers, PaychexConfigError } from "@/lib/paychex/api";
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
    const [{ active, all }, live, notSame, taken] = await Promise.all([
      fetchPaychexWorkers(), loadLiveEmployees(), loadNotSame(), loadTakenPayrollIds(),
    ]);
    // Active workers carry contact info; use those copies where we have them.
    const byId = new Map(all.map((w) => [w.workerId, w]));
    for (const w of active) byId.set(w.workerId, w);
    // Workers AOS sent may still be in progress and missing from the list.
    for (const p of people) {
      if (p.paychexWorkerId && !byId.has(p.paychexWorkerId)) {
        const w = await fetchPaychexWorker(p.paychexWorkerId);
        if (w) byId.set(w.workerId, w);
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
    return NextResponse.json({ matches, linked, checkedAt: new Date().toISOString() });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: e instanceof PaychexConfigError ? 503 : 500 });
  }
}
