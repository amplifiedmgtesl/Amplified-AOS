/**
 * lib/onboarding/server.ts — data loading for the Onboarding screen (backlog #120).
 *
 * SERVER ONLY (service-role client). Import from app/api/onboarding/** only.
 */

import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { buildOnboardingRows, pairKey, windowRange, type Activity, type OnbEmployee, type OnboardingRow } from "./plan";

export async function requireAdmin(req: NextRequest): Promise<string | null> {
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!token) return null;
  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !user) return null;
  const { data: profile } = await supabaseAdmin.from("profiles").select("role").eq("id", user.id).single();
  return profile?.role === "admin" ? user.id : null;
}

/** Today in Amplified's time zone, YYYY-MM-DD. */
export function todayLocal(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
}

const EMP_COLS = "employee_key, full_name, first_name, last_name, email, phone, employment_type, rippling_employee_id, status, paychex_worker_id, paychex_invited_at, is_deleted";

export function toOnbEmployee(r: any): OnbEmployee {
  return {
    employeeKey: r.employee_key,
    name: (r.full_name || [r.first_name, r.last_name].filter(Boolean).join(" ") || r.employee_key).trim(),
    email: r.email ?? "",
    phone: r.phone ?? "",
    employmentType: r.employment_type ?? "",
    payrollId: r.rippling_employee_id == null ? null : Number(r.rippling_employee_id),
    status: r.status ?? "",
    paychexWorkerId: r.paychex_worker_id ?? null,
    paychexInvitedAt: r.paychex_invited_at ?? null,
  };
}

/** Every live employee, paged — PostgREST caps a select at 1,000 rows. */
export async function loadLiveEmployees(): Promise<OnbEmployee[]> {
  const out: OnbEmployee[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabaseAdmin.from("employees").select(EMP_COLS)
      .or("is_deleted.is.null,is_deleted.eq.false").order("employee_key").range(from, from + 999);
    if (error) throw new Error(error.message);
    for (const r of data ?? []) out.push(toOnbEmployee(r));
    if (!data || data.length < 1000) break;
  }
  return out;
}

export async function loadEmployee(key: string): Promise<any | null> {
  const { data, error } = await supabaseAdmin.from("employees").select("*").eq("employee_key", key).maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

async function pagedSelect(build: (from: number, to: number) => any): Promise<any[]> {
  const rows: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(from, from + 999);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return rows;
}

function chunks<T>(list: T[], n = 200): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n));
  return out;
}

/** Confirmed crew + timesheet rows in the window, with job names. */
async function loadActivity(today: string): Promise<Activity[]> {
  const { from, to } = windowRange(today);

  const entries = await pagedSelect((a, b) => supabaseAdmin.from("timesheet_entries")
    .select("id, employee_key, work_date, job_id, total_hours")
    .gte("work_date", from).lte("work_date", to).not("employee_key", "is", null)
    .order("id").range(a, b));

  const days = await pagedSelect((a, b) => supabaseAdmin.from("job_request_days")
    .select("id, job_request_id, event_date")
    .gte("event_date", from).lte("event_date", to)
    .order("id").range(a, b));
  const dayById = new Map(days.map((d) => [d.id, d]));
  const assignments: any[] = [];
  for (const ids of chunks(days.map((d) => d.id))) {
    const { data, error } = await supabaseAdmin.from("job_request_assignments")
      .select("job_request_day_id, employee_key").in("job_request_day_id", ids)
      .eq("confirmed", true).not("employee_key", "is", null);
    if (error) throw new Error(error.message);
    assignments.push(...(data ?? []));
  }

  const jobIds = [...new Set([
    ...entries.map((e) => e.job_id),
    ...assignments.map((x) => dayById.get(x.job_request_day_id)?.job_request_id),
  ].filter(Boolean))];
  const jobName = new Map<string, string>();
  for (const ids of chunks(jobIds)) {
    const { data, error } = await supabaseAdmin.from("job_requests").select("id, event_abbr, event_name").in("id", ids);
    if (error) throw new Error(error.message);
    for (const j of data ?? []) jobName.set(j.id, j.event_abbr || j.event_name || "");
  }

  const out: Activity[] = [];
  for (const e of entries) {
    out.push({ employeeKey: e.employee_key, date: String(e.work_date).slice(0, 10), kind: "time",
      jobName: jobName.get(e.job_id) ?? "", hours: Number(e.total_hours ?? 0) });
  }
  for (const x of assignments) {
    const d = dayById.get(x.job_request_day_id);
    if (!d) continue;
    out.push({ employeeKey: x.employee_key, date: String(d.event_date).slice(0, 10), kind: "crew",
      jobName: jobName.get(d.job_request_id) ?? "", hours: 0 });
  }
  return out;
}

async function loadNotSame(): Promise<Set<string>> {
  const rows = await pagedSelect((a, b) => supabaseAdmin.from("employee_not_duplicate")
    .select("key_a, key_b").order("key_a").range(a, b));
  return new Set(rows.map((r) => pairKey(r.key_a, r.key_b)));
}

export async function loadOnboardingRows(): Promise<{ today: string; rows: OnboardingRow[] }> {
  const today = todayLocal();
  const [all, activity, notSame] = await Promise.all([loadLiveEmployees(), loadActivity(today), loadNotSame()]);
  return { today, rows: buildOnboardingRows(today, all, activity, notSame) };
}
