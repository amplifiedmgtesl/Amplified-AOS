/**
 * lib/paychex/sync-server.ts — the database side of Sync from Paychex,
 * shared by the Payroll page's sync (app/api/paychex/sync) and the employee
 * profile's one-person sync (app/api/employee-paychex). SERVER ONLY.
 *
 * Every applied change is logged to paychex_sync_log with the row as it was
 * before.
 */

import { supabaseAdmin } from "@/lib/supabase/admin";
import type { AosEmployee, FieldChange, SyncChange } from "./sync-plan";

const EMP_COLS = "employee_key, full_name, first_name, last_name, payroll_name, status, rippling_employee_id, employment_type, phone, email, address, city, state_code, zip, is_deleted";

/** All employees, paged — PostgREST caps a select at 1,000 rows. */
export async function loadEmployees(): Promise<{ live: AosEmployee[]; reservedIds: Set<number> }> {
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
      payrollName: r.payroll_name ?? "",
      status: r.status ?? "",
      payrollId, employmentType: r.employment_type ?? "", phone: r.phone ?? "", email: r.email ?? "",
      address: r.address ?? "", city: r.city ?? "", stateCode: r.state_code ?? "", zip: r.zip ?? "",
    });
  }
  return { live, reservedIds };
}

const COLUMN: Record<FieldChange["field"], string> = {
  status: "status", payrollName: "payroll_name", phone: "phone", email: "email", address: "address", city: "city", stateCode: "state_code", zip: "zip",
};

function patchFor(fields: FieldChange[]): Record<string, string> {
  const patch: Record<string, string> = {};
  for (const f of fields) {
    patch[COLUMN[f.field]] = f.to;
    if (f.field === "stateCode") patch.state = f.to;   // keep the two state columns in step
  }
  return patch;
}

export async function applyOne(c: SyncChange, runId: string, userId: string, seq: number) {
  let before: any = null;
  let after: Record<string, unknown> = {};
  let employeeKey: string | null = null;
  try {
    if (c.kind === "create") {
      employeeKey = `emp-${Date.now() + seq}`;
      after = {
        employee_key: employeeKey, full_name: c.name, first_name: c.firstName, last_name: c.lastName,
        employment_type: c.employmentType, rippling_employee_id: c.payrollId, status: c.contact.status || "Active",
        source: "paychex-sync", hire_date: c.hireDate, is_deleted: false, payroll_name: c.contact.payrollName || null,
        phone: c.contact.phone || null, email: c.contact.email || null, address: c.contact.address || null,
        city: c.contact.city || null, state_code: c.contact.stateCode || null, state: c.contact.stateCode || null,
        zip: c.contact.zip || null,
      };
      const { error } = await supabaseAdmin.from("employees").insert(after);
      if (error) throw new Error(error.message);
    } else if (c.kind === "reid" || c.kind === "clear") {
      // Swap or blank a Payroll ID Paychex doesn't have. Only lands if the
      // record still holds the old number.
      employeeKey = c.employeeKey;
      const fromId = c.kind === "reid" ? c.fromPayrollId : c.payrollId;
      const { data, error: readErr } = await supabaseAdmin.from("employees").select("*").eq("employee_key", c.employeeKey).single();
      if (readErr) throw new Error(readErr.message);
      before = data;
      after = { rippling_employee_id: c.kind === "reid" ? c.payrollId : null };
      const { data: updated, error } = await supabaseAdmin.from("employees").update(after)
        .eq("employee_key", c.employeeKey).eq("rippling_employee_id", fromId).select("employee_key");
      if (error) throw new Error(error.message);
      if (!updated?.length) throw new Error("Record changed since the preview — run the sync again.");
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

