/**
 * Payroll export settings + pay component map (migration 20261012a).
 * Edited in Maintenance → Payroll Export; read by the Paychex CSV export.
 */

import { supabase } from "@/lib/supabase/client";
import type { EmployeeRecord } from "./types";
import type {
  ComponentMapRow,
  JobNameSource,
  PayType,
  PayrollExportSettings,
  WorkerType,
} from "./paychex-export";

export type ComponentMapRecord = ComponentMapRow & { id: string };

export async function loadPayrollExportSettings(): Promise<PayrollExportSettings | null> {
  const { data, error } = await supabase
    .from("payroll_settings")
    .select("*")
    .eq("id", "singleton")
    .maybeSingle();
  if (error || !data) {
    if (error) console.error("[payroll-settings] load failed:", error);
    return null;
  }
  return {
    provider: "paychex",
    companyId: data.company_id ?? "",
    jobNameSource: (data.job_name_source ?? "event_abbr") as JobNameSource,
  };
}

export async function savePayrollExportSettings(s: PayrollExportSettings): Promise<string | null> {
  const { error } = await supabase
    .from("payroll_settings")
    .upsert({
      id: "singleton",
      provider: s.provider,
      company_id: s.companyId.trim(),
      job_name_source: s.jobNameSource,
    });
  return error ? error.message : null;
}

export async function loadComponentMap(provider = "paychex"): Promise<ComponentMapRecord[] | null> {
  const { data, error } = await supabase
    .from("payroll_component_map")
    .select("id, worker_type, pay_type, component_name")
    .eq("provider", provider);
  if (error || !data) {
    if (error) console.error("[payroll-component-map] load failed:", error);
    return null;
  }
  return data.map((r: any) => ({
    id: r.id,
    workerType: r.worker_type as WorkerType,
    payType: r.pay_type as PayType,
    componentName: r.component_name ?? "",
  }));
}

/** Saves the name exactly as typed — Paychex matches it character for
 *  character, so we don't trim or re-case anything but outer whitespace. */
export async function saveComponentName(id: string, componentName: string): Promise<string | null> {
  const { error } = await supabase
    .from("payroll_component_map")
    .update({ component_name: componentName.trim() })
    .eq("id", id);
  return error ? error.message : null;
}

/** Payroll ID + employment type for just the people on a run, read straight
 *  from the DB. The app's employee cache is loaded when the page opens, so an
 *  ID added in another tab or by someone else wouldn't be seen until a
 *  refresh — and the export would wrongly leave that person out. */
export async function loadEmployeesForExport(employeeKeys: string[]): Promise<EmployeeRecord[]> {
  const out: EmployeeRecord[] = [];
  const ids = [...new Set(employeeKeys.filter(Boolean))];
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await supabase
      .from("employees")
      .select("employee_key, full_name, first_name, last_name, rippling_employee_id, employment_type")
      .in("employee_key", ids.slice(i, i + 200));
    if (error) throw new Error(`Couldn't load employees: ${error.message}`);
    for (const r of data ?? []) {
      out.push({
        employeeKey: r.employee_key,
        fullName: r.full_name ?? "",
        firstName: r.first_name ?? "",
        lastName: r.last_name ?? "",
        employmentType: r.employment_type ?? undefined,
        type: r.employment_type === "Employee" ? "staff" : "contractor",
        ripplingEmployeeId: r.rippling_employee_id == null ? null : Number(r.rippling_employee_id),
      });
    }
  }
  return out;
}

/** Event abbr + name for just the jobs on a run, read straight from the DB
 *  rather than the app cache. */
export async function loadJobsForExport(jobIds: string[]): Promise<Map<string, { eventAbbr: string | null; eventName: string | null }>> {
  const m = new Map<string, { eventAbbr: string | null; eventName: string | null }>();
  const ids = [...new Set(jobIds.filter(Boolean))];
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await supabase
      .from("job_requests")
      .select("id, event_abbr, event_name")
      .in("id", ids.slice(i, i + 200));
    if (error) throw new Error(`Couldn't load job names: ${error.message}`);
    for (const r of data ?? []) m.set(r.id, { eventAbbr: r.event_abbr ?? null, eventName: r.event_name ?? null });
  }
  return m;
}
