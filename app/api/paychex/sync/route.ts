/**
 * app/api/paychex/sync/route.ts — "Sync from Paychex" (backlog #117).
 *
 * GET  → preview: what Paychex would change in AOS. The one exception:
 *        new-Payroll-ID links that are CLEAR matches (the same rule the
 *        Onboarding page uses, clearMatch in lib/onboarding/plan.ts) are
 *        applied straight away and returned as `autoLinked` (John,
 *        2026-10-20). Everything else waits for Apply.
 * POST → { ids: string[] } apply the ticked changes. The plan is rebuilt
 *        from fresh Paychex + AOS data and only matching ids are applied,
 *        so the browser can never send arbitrary employee edits.
 *
 * Admins only. Every applied change is logged to paychex_sync_log with the
 * row as it was before.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { fetchPaychexWorkers, PaychexConfigError } from "@/lib/paychex/api";
import { planPaychexSync, type PaychexWorker, type SyncChange } from "@/lib/paychex/sync-plan";
import { clearMatch, findDuplicates, paychexMatches } from "@/lib/onboarding/plan";
import { loadLiveEmployees, loadNotSame } from "@/lib/onboarding/server";
import { applyOne, loadEmployees } from "@/lib/paychex/sync-server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function requireAdmin(req: NextRequest): Promise<string | null> {
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!token) return null;
  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !user) return null;
  const { data: profile } = await supabaseAdmin.from("profiles").select("role").eq("id", user.id).single();
  return profile?.role === "admin" ? user.id : null;
}

async function buildPlan() {
  const [{ active, all }, { live, reservedIds }] = await Promise.all([fetchPaychexWorkers(), loadEmployees()]);
  return { plan: planPaychexSync(active, live, reservedIds, all), active, all, reservedIds };
}

/** The proposed links that are clear matches under the Onboarding rule. */
async function clearLinks(changes: SyncChange[], active: PaychexWorker[], all: PaychexWorker[], reservedIds: Set<number>) {
  const links = changes.filter((c): c is Extract<SyncChange, { kind: "link" }> => c.kind === "link");
  if (!links.length) return [];
  const [onb, notSame] = await Promise.all([loadLiveEmployees(), loadNotSame()]);
  const byKey = new Map(onb.map((e) => [e.employeeKey, e]));
  const byId = new Map(all.map((w) => [w.workerId, w]));
  for (const w of active) byId.set(w.workerId, w);
  const workers = [...byId.values()];
  const taken = new Set<number>(reservedIds);
  for (const e of onb) if (e.payrollId != null) taken.add(e.payrollId);
  return links.filter((c) => {
    const person = byKey.get(c.employeeKey);
    if (!person) return false;
    const m = clearMatch(person, paychexMatches(person, workers), (id) => byId.get(id), findDuplicates(person, onb, notSame), taken);
    return m?.payrollId === c.payrollId;
  });
}

function errorResponse(e: unknown) {
  const msg = e instanceof Error ? e.message : "Unknown error";
  return NextResponse.json({ error: msg }, { status: e instanceof PaychexConfigError ? 503 : 500 });
}

export async function GET(req: NextRequest) {
  const userId = await requireAdmin(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const { plan, active, all, reservedIds } = await buildPlan();
    const auto = await clearLinks(plan.changes, active, all, reservedIds);
    const runId = `pxs-auto-${Date.now()}`;
    const autoLinked: { employeeKey: string; name: string; payrollId: number; paychexName: string }[] = [];
    const done = new Set<string>();
    for (let i = 0; i < auto.length; i++) {
      const r = await applyOne(auto[i], runId, userId, i);
      if (r.ok) {
        done.add(auto[i].id);
        autoLinked.push({ employeeKey: auto[i].employeeKey, name: auto[i].name, payrollId: auto[i].payrollId, paychexName: auto[i].paychexName });
      }
    }
    return NextResponse.json({
      ...plan, changes: plan.changes.filter((c) => !done.has(c.id)), autoLinked, fetchedAt: new Date().toISOString(),
    });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(req: NextRequest) {
  const userId = await requireAdmin(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let ids: string[] = [];
  try {
    const body = await req.json();
    ids = Array.isArray(body?.ids) ? body.ids.filter((x: unknown) => typeof x === "string") : [];
  } catch { /* empty body */ }
  if (ids.length === 0) return NextResponse.json({ error: "Nothing selected." }, { status: 400 });

  try {
    const { plan } = await buildPlan();
    const wanted = new Set(ids);
    const selected = plan.changes.filter((c) => wanted.has(c.id));
    const runId = `pxs-${Date.now()}`;
    const results = [];
    for (let i = 0; i < selected.length; i++) results.push(await applyOne(selected[i], runId, userId, i));
    return NextResponse.json({
      runId,
      applied: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok),
      // Ticked in the preview but no longer proposed (fixed elsewhere meanwhile).
      skipped: ids.filter((id) => !selected.some((c) => c.id === id)).length,
    });
  } catch (e) {
    return errorResponse(e);
  }
}
