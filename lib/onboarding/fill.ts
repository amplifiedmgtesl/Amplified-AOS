/**
 * lib/onboarding/fill.ts — fill blanks in Paychex from AOS (John, 2026-11-07).
 *
 * SERVER ONLY. Used right after "Send to Paychex" succeeds, and by the
 * "Fill Paychex blanks" button for people already sent. What gets filled is
 * decided in lib/paychex/fill.ts: phone, mailing address and, while the hire
 * is still in progress, hire date / Non-exempt / location / organization.
 * Only blanks — nothing Paychex already has is changed. Every live fill is
 * logged to paychex_onboard_log (request.action = "fill").
 */

import { supabaseAdmin } from "@/lib/supabase/admin";
import { fillPaychexWorker, type FillResult } from "@/lib/paychex/api";
import { hireDateFor, type AosFill } from "@/lib/paychex/fill";

/** Their first day on a timesheet or a confirmed crew day, any time. */
async function firstWorkDay(employeeKey: string): Promise<string | null> {
  const { data: ts } = await supabaseAdmin.from("timesheet_entries").select("work_date")
    .eq("employee_key", employeeKey).not("work_date", "is", null).order("work_date").limit(1);
  const { data: asg } = await supabaseAdmin.from("job_request_assignments")
    .select("job_request_day_id").eq("employee_key", employeeKey).eq("confirmed", true);
  const dayIds = [...new Set((asg ?? []).map((a: any) => a.job_request_day_id).filter(Boolean))];
  const { data: days } = dayIds.length
    ? await supabaseAdmin.from("job_request_days").select("event_date").in("id", dayIds).order("event_date").limit(1)
    : { data: [] as any[] };
  const dates = [ts?.[0]?.work_date, days?.[0]?.event_date]
    .filter(Boolean).map((d: string) => String(d).slice(0, 10)).sort();
  return dates[0] ?? null;
}

export async function aosFillFor(row: any): Promise<AosFill> {
  const applied = row.applied_at ? String(row.applied_at).slice(0, 10) : null;
  return {
    phone: row.phone ?? "",
    street: row.address ?? "",
    city: row.city ?? "",
    stateCode: row.state_code || (/^[A-Za-z]{2}$/.test(row.state ?? "") ? row.state : ""),
    zip: row.zip ?? "",
    hireDate: hireDateFor(applied, await firstWorkDay(row.employee_key)),
  };
}

export type FillOutcome = {
  employeeKey: string;
  name: string;
  workerId: string;
  fills: string[];      // what Paychex is missing and AOS has
  missing: string[];    // what Paychex is missing and AOS doesn't have either
  done: string[];       // written (live only)
  errors: string[];
};

/** fetch() throws a TypeError when the connection itself fails (no HTTP reply). */
function isNetworkError(err: unknown): boolean {
  return err instanceof TypeError;
}

export async function fillOne(row: any, userId: string, live: boolean): Promise<FillOutcome> {
  const name = (row.full_name || [row.first_name, row.last_name].filter(Boolean).join(" ") || row.employee_key).trim();
  const base = { employeeKey: row.employee_key, name, workerId: row.paychex_worker_id as string };
  let r: FillResult;
  try {
    const aos = await aosFillFor(row);
    try {
      r = await fillPaychexWorker(row.paychex_worker_id, aos, live);
    } catch (err) {
      // A dropped connection ("fetch failed") gets one more try after a
      // second. Safe even mid-write: the retry re-reads Paychex and only
      // fills what's still blank. HTTP errors aren't retried.
      if (!isNetworkError(err)) throw err;
      await new Promise((res) => setTimeout(res, 1000));
      r = await fillPaychexWorker(row.paychex_worker_id, aos, live);
    }
  } catch (err) {
    return { ...base, fills: [], missing: [], done: [], errors: [err instanceof Error ? err.message : "Unknown error"] };
  }
  const out: FillOutcome = {
    ...base,
    fills: r.plan?.fills ?? [], missing: r.plan?.missing ?? [], done: r.done, errors: r.errors,
  };
  if (live && (r.done.length || r.errors.length)) {
    const { error } = await supabaseAdmin.from("paychex_onboard_log").insert({
      sent_by: userId, employee_key: row.employee_key, dry_run: false, worker_id: row.paychex_worker_id,
      request: { action: "fill", fields: r.plan?.fills ?? [] },
      response: { done: r.done }, ok: r.errors.length === 0, error: r.errors.join("; ") || null,
    });
    if (error) console.error("[onboarding/fill] log failed:", error);
  }
  return out;
}
