/**
 * app/api/paychex/sync/route.ts — "Sync from Paychex" (backlog #117).
 *
 * Reads the Paychex copy in AOS (lib/paychex/snapshot.ts), not Paychex.
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
import { PaychexConfigError } from "@/lib/paychex/api";
import { planPaychexSync } from "@/lib/paychex/sync-plan";
import { loadSnapshot } from "@/lib/paychex/snapshot";
import { applyOne, clearLinks, loadEmployees } from "@/lib/paychex/sync-server";

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

/** The plan, from the Paychex copy in AOS (no Paychex calls). The copy is
 *  refreshed Monday night and by "Refresh now"; each refresh already applies
 *  what Paychex is the source of truth for, so this mostly lists what's
 *  left for a person to decide. */
async function buildPlan() {
  const [snap, { live, reservedIds }] = await Promise.all([loadSnapshot(), loadEmployees()]);
  if (!snap.at) throw new Error("No copy of Paychex yet. Click Refresh now.");
  const { active, all } = snap;
  return { plan: planPaychexSync(active, live, reservedIds, all), active, all, reservedIds, snapshotAt: snap.at };
}

function errorResponse(e: unknown) {
  const msg = e instanceof Error ? e.message : "Unknown error";
  return NextResponse.json({ error: msg }, { status: e instanceof PaychexConfigError ? 503 : 500 });
}

export async function GET(req: NextRequest) {
  const userId = await requireAdmin(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const { plan, active, all, reservedIds, snapshotAt } = await buildPlan();
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
      ...plan, changes: plan.changes.filter((c) => !done.has(c.id)), autoLinked, fetchedAt: snapshotAt,
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
