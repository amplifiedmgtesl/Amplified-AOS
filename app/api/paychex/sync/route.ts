/**
 * app/api/paychex/sync/route.ts — "Sync from Paychex" (backlog #117).
 *
 * GET  → preview: what Paychex would change in AOS. Changes nothing.
 * POST → { ids: string[] } apply the ticked changes. The plan is rebuilt
 *        from fresh Paychex + AOS data and only matching ids are applied,
 *        so the browser can never send arbitrary employee edits.
 *
 * Admins only. Every applied change is logged to paychex_sync_log with the
 * row as it was before.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { fetchActivePaychexWorkers, PaychexConfigError } from "@/lib/paychex/api";
import { planPaychexSync, type AosEmployee, type SyncChange, type FieldChange } from "@/lib/paychex/sync-plan";

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

const EMP_COLS = "employee_key, full_name, first_name, last_name, rippling_employee_id, employment_type, phone, email, address, city, state_code, zip, is_deleted";

/** All employees, paged — PostgREST caps a select at 1,000 rows. */
async function loadEmployees(): Promise<{ live: AosEmployee[]; reservedIds: Set<number> }> {
  const rows: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabaseAdmin.from("employees").select(EMP_COLS)
      .order("employee_key").range(from, from + 999);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  const live: AosEmployee[] = [];
  const reservedIds = new Set<number>();
  for (const r of rows) {
    const payrollId = r.rippling_employee_id == null ? null : Number(r.rippling_employee_id);
    if (r.is_deleted) { if (payrollId != null) reservedIds.add(payrollId); continue; }
    live.push({
      employeeKey: r.employee_key, fullName: r.full_name ?? "", firstName: r.first_name ?? "", lastName: r.last_name ?? "",
      payrollId, employmentType: r.employment_type ?? "", phone: r.phone ?? "", email: r.email ?? "",
      address: r.address ?? "", city: r.city ?? "", stateCode: r.state_code ?? "", zip: r.zip ?? "",
    });
  }
  return { live, reservedIds };
}

async function buildPlan() {
  const [workers, { live, reservedIds }] = await Promise.all([fetchActivePaychexWorkers(), loadEmployees()]);
  return planPaychexSync(workers, live, reservedIds);
}

function errorResponse(e: unknown) {
  const msg = e instanceof Error ? e.message : "Unknown error";
  return NextResponse.json({ error: msg }, { status: e instanceof PaychexConfigError ? 503 : 500 });
}

export async function GET(req: NextRequest) {
  if (!(await requireAdmin(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const plan = await buildPlan();
    return NextResponse.json({ ...plan, fetchedAt: new Date().toISOString() });
  } catch (e) {
    return errorResponse(e);
  }
}

const COLUMN: Record<FieldChange["field"], string> = {
  phone: "phone", email: "email", address: "address", city: "city", stateCode: "state_code", zip: "zip",
};

function patchFor(fields: FieldChange[]): Record<string, string> {
  const patch: Record<string, string> = {};
  for (const f of fields) {
    patch[COLUMN[f.field]] = f.to;
    if (f.field === "stateCode") patch.state = f.to;   // keep the two state columns in step
  }
  return patch;
}

async function applyOne(c: SyncChange, runId: string, userId: string, seq: number) {
  let before: any = null;
  let after: Record<string, unknown> = {};
  let employeeKey: string | null = null;
  try {
    if (c.kind === "create") {
      employeeKey = `emp-${Date.now() + seq}`;
      after = {
        employee_key: employeeKey, full_name: c.name, first_name: c.firstName, last_name: c.lastName,
        employment_type: c.employmentType, rippling_employee_id: c.payrollId, status: "Active",
        source: "paychex-sync", hire_date: c.hireDate, is_deleted: false,
        phone: c.contact.phone || null, email: c.contact.email || null, address: c.contact.address || null,
        city: c.contact.city || null, state_code: c.contact.stateCode || null, state: c.contact.stateCode || null,
        zip: c.contact.zip || null,
      };
      const { error } = await supabaseAdmin.from("employees").insert(after);
      if (error) throw new Error(error.message);
    } else {
      employeeKey = c.employeeKey;
      const { data, error: readErr } = await supabaseAdmin.from("employees").select("*").eq("employee_key", c.employeeKey).single();
      if (readErr) throw new Error(readErr.message);
      before = data;
      after = patchFor(c.fields);
      let q = supabaseAdmin.from("employees").update(
        c.kind === "link" ? { ...after, rippling_employee_id: c.payrollId } : after,
      ).eq("employee_key", c.employeeKey);
      // A link only lands on a record that still has no Payroll ID.
      if (c.kind === "link") { after = { ...after, rippling_employee_id: c.payrollId }; q = q.is("rippling_employee_id", null); }
      const { data: updated, error } = await q.select("employee_key");
      if (error) throw new Error(error.message);
      if (!updated?.length) throw new Error("Record changed since the preview — run the sync again.");
    }
    await supabaseAdmin.from("paychex_sync_log").insert({
      run_id: runId, run_by: userId, change_id: c.id, kind: c.kind, employee_key: employeeKey,
      payroll_id: c.payrollId, before, after, ok: true,
    });
    return { id: c.id, ok: true as const };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    await supabaseAdmin.from("paychex_sync_log").insert({
      run_id: runId, run_by: userId, change_id: c.id, kind: c.kind, employee_key: employeeKey,
      payroll_id: c.payrollId, before, after, ok: false, error: msg,
    });
    return { id: c.id, ok: false as const, error: msg };
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
    const plan = await buildPlan();
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
