/**
 * app/api/employee-paychex/route.ts — the Paychex section of an employee's
 * profile (2026-10-20). Admins only.
 *
 * Reads the Paychex copy in AOS (docs/paychex-snapshot-plan.md), so opening
 * a profile makes no Paychex calls, except one for someone AOS sent who is
 * still waiting for a Payroll ID.
 *
 * GET ?key=…
 *   • no Payroll ID ("onboard"): possible AOS duplicates and possible Paychex
 *     matches, the same rules as the Onboarding page. A clear match gets its
 *     Payroll ID straight away (returned in `linked`).
 *   • has a Payroll ID ("sync"): with &sync=1, what the copy of Paychex has
 *     that differs for this one person, the same rules as Sync from Paychex.
 * POST { key, ids } → apply the ticked sync changes for this person.
 */

import { NextRequest, NextResponse } from "next/server";
import { fetchPaychexWorker, PaychexConfigError } from "@/lib/paychex/api";
import { planPaychexSync } from "@/lib/paychex/sync-plan";
import { loadSnapshot, lookupWorkers, needsLiveRead, saveWorker } from "@/lib/paychex/snapshot";
import { clearMatch, findDuplicates, paychexMatches } from "@/lib/onboarding/plan";
import { loadEmployee, loadLiveEmployees, loadNotSame, loadTakenPayrollIds, requireAdmin, toOnbEmployee } from "@/lib/onboarding/server";
import { linkPaychexId } from "@/lib/onboarding/link";
import { applyOne, loadEmployees } from "@/lib/paychex/sync-server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function errorResponse(e: unknown) {
  const msg = e instanceof Error ? e.message : "Unknown error";
  return NextResponse.json({ error: msg }, { status: e instanceof PaychexConfigError ? 503 : 500 });
}

/** Sync changes the copy of Paychex has for this one person. */
async function personSync(key: string, payrollId: number) {
  const snap = await loadSnapshot();
  const worker = snap.active.find((w) => Number(w.employeeId) === payrollId) ?? null;
  const { live, reservedIds } = await loadEmployees();
  const plan = planPaychexSync(worker ? [worker] : [], live, reservedIds, snap.all);
  return {
    snapshotAt: snap.at,
    inPaychex: !!worker,
    changes: plan.changes.filter((c) => "employeeKey" in c && c.employeeKey === key),
    reports: plan.reports.filter((r) => r.employeeKey === key),
  };
}

export async function GET(req: NextRequest) {
  const userId = await requireAdmin(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const key = req.nextUrl.searchParams.get("key") ?? "";
  if (!key) return NextResponse.json({ error: "Missing employee." }, { status: 400 });
  try {
    const row = await loadEmployee(key);
    if (!row || row.is_deleted) return NextResponse.json({ error: "Employee not found." }, { status: 404 });
    const person = toOnbEmployee(row);
    const [live, notSame] = await Promise.all([loadLiveEmployees(), loadNotSame()]);
    const duplicates = findDuplicates(person, live, notSame);

    if (person.payrollId != null) {
      if (req.nextUrl.searchParams.get("sync") !== "1") return NextResponse.json({ mode: "sync", duplicates });
      return NextResponse.json({ mode: "sync", duplicates, ...(await personSync(key, person.payrollId)) });
    }

    // Onboard: the copy of Paychex; someone AOS sent is re-read live (one call).
    const snap = await loadSnapshot();
    if (!snap.at) return NextResponse.json({ mode: "onboard", duplicates, matches: [], linked: null, sentAt: person.paychexInvitedAt, snapshotAt: null });
    const byId = new Map(lookupWorkers(snap).map((w) => [w.workerId, w]));
    if (person.paychexWorkerId && needsLiveRead(snap, person.paychexWorkerId)) {
      const w = await fetchPaychexWorker(person.paychexWorkerId);
      if (w) { byId.set(w.workerId, w); await saveWorker(w, true); }
    }
    const matches = paychexMatches(person, [...byId.values()]);
    const taken = await loadTakenPayrollIds();
    const clear = clearMatch(person, matches, (id) => byId.get(id), duplicates, taken);
    if (clear?.payrollId != null) {
      const r = await linkPaychexId(key, byId.get(clear.workerId)!, userId, `prof-auto-${Date.now()}`);
      if ("payrollId" in r) {
        return NextResponse.json({ mode: "onboard", duplicates, matches: [], linked: { payrollId: r.payrollId, paychexName: clear.name }, sentAt: person.paychexInvitedAt, snapshotAt: snap.at });
      }
    }
    return NextResponse.json({ mode: "onboard", duplicates, matches, linked: null, sentAt: person.paychexInvitedAt, snapshotAt: snap.at });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(req: NextRequest) {
  const userId = await requireAdmin(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const key = typeof body?.key === "string" ? body.key : "";
  const ids: string[] = Array.isArray(body?.ids) ? body.ids.filter((x: unknown) => typeof x === "string") : [];
  if (!key || !ids.length) return NextResponse.json({ error: "Nothing selected." }, { status: 400 });
  try {
    const row = await loadEmployee(key);
    const payrollId = row?.rippling_employee_id == null ? null : Number(row.rippling_employee_id);
    if (payrollId == null) return NextResponse.json({ error: "This person has no Payroll ID." }, { status: 400 });
    // Rebuilt from fresh data: only changes still proposed for this person apply.
    const { changes } = await personSync(key, payrollId);
    const wanted = new Set(ids);
    const selected = changes.filter((c) => wanted.has(c.id));
    const runId = `prof-${Date.now()}`;
    const results = [];
    for (let i = 0; i < selected.length; i++) results.push(await applyOne(selected[i], runId, userId, i));
    return NextResponse.json({ applied: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok) });
  } catch (e) {
    return errorResponse(e);
  }
}
