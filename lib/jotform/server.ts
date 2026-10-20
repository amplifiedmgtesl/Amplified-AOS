/**
 * lib/jotform/server.ts — writes for website applicants (backlog #121).
 *
 * SERVER ONLY (service-role client). Used by the JotForm webhook and the
 * one-time load. The rules live in ./application.ts (pure, tested).
 *
 * Each submission is handled once: jotform_application_log.submission_id is
 * unique, and a submission already logged (other than an error) is skipped.
 */

import { supabaseAdmin } from "@/lib/supabase/admin";
import { applyToList, decide, logSummary, newestFirst, type AppEmployee, type Application, type Outcome } from "./application";

const EMP_COLS = "employee_key, full_name, first_name, last_name, email, phone, address, city, state_code, zip, applied_at, jotform_submission_id";

function toAppEmployee(r: any): AppEmployee {
  return {
    employeeKey: r.employee_key,
    name: (r.full_name || [r.first_name, r.last_name].filter(Boolean).join(" ") || "").trim(),
    email: r.email ?? "", phone: r.phone ?? "", address: r.address ?? "", city: r.city ?? "",
    stateCode: r.state_code ?? "", zip: r.zip ?? "",
    appliedAt: r.applied_at ? String(r.applied_at).slice(0, 10) : null,
    submissionId: r.jotform_submission_id ?? null,
  };
}

/** Every live employee, paged — PostgREST caps a select at 1,000 rows. */
async function loadAppEmployees(): Promise<AppEmployee[]> {
  const out: AppEmployee[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabaseAdmin.from("employees").select(EMP_COLS)
      .or("is_deleted.is.null,is_deleted.eq.false").order("employee_key").range(from, from + 999);
    if (error) throw new Error(error.message);
    for (const r of data ?? []) out.push(toAppEmployee(r));
    if (!data || data.length < 1000) break;
  }
  return out;
}

/** Submission IDs already handled (errors excluded, so they can be retried). */
async function loadDone(ids: string[]): Promise<Set<string>> {
  const done = new Set<string>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await supabaseAdmin.from("jotform_application_log")
      .select("submission_id").in("submission_id", ids.slice(i, i + 200)).neq("outcome", "error");
    if (error) throw new Error(error.message);
    for (const r of data ?? []) done.add(r.submission_id);
  }
  return done;
}

export type ReportRow = {
  submissionId: string;
  submittedOn: string;
  name: string;
  email: string;
  outcome: Outcome | "already" | "error";
  matchReason: string | null;
  employeeKey: string | null;
  differences: string[];
  notes: string[];
};

/** Handle a batch (the webhook sends one). Newest first, so a repeat
 *  applicant's latest answers win and older ones only fill what's left.
 *  dryRun: decide everything, write nothing. */
export async function handleApplications(apps: Application[], via: "webhook" | "load", dryRun: boolean): Promise<ReportRow[]> {
  let list = await loadAppEmployees();
  const done = await loadDone(apps.map((a) => a.submissionId).filter(Boolean));
  const seen = new Set<string>();
  const report: ReportRow[] = [];

  for (const a of newestFirst(apps)) {
    const base = { submissionId: a.submissionId, submittedOn: a.submittedOn, name: `${a.firstName} ${a.lastName}`.trim(), email: a.email };
    if (a.submissionId && (done.has(a.submissionId) || seen.has(a.submissionId))) {
      report.push({ ...base, outcome: "already", matchReason: null, employeeKey: null, differences: [], notes: [] });
      continue;
    }
    seen.add(a.submissionId);
    const d = decide(a, list);
    list = applyToList(list, a, d);
    const row: ReportRow = { ...base, outcome: d.outcome, matchReason: d.matchReason, employeeKey: d.employeeKey, differences: d.differences, notes: d.notes };
    if (dryRun) { report.push(row); continue; }

    let before: any = null;
    let outcome: ReportRow["outcome"] = d.outcome;
    let error: string | null = null;
    try {
      if (d.outcome === "created") {
        const { error: e } = await supabaseAdmin.from("employees").insert(d.write!);
        if (e) throw new Error(e.message);
      } else if (d.write && d.employeeKey) {
        const { data, error: readErr } = await supabaseAdmin.from("employees").select("*").eq("employee_key", d.employeeKey).single();
        if (readErr) throw new Error(readErr.message);
        before = data;
        // Fill-blank columns only land if the field is still blank.
        const patch = { ...d.write };
        for (const col of ["email", "phone", "address", "city", "state_code", "state", "zip"]) {
          if (col in patch && String(data?.[col] ?? "").trim()) delete patch[col];
        }
        const { error: e } = await supabaseAdmin.from("employees").update(patch).eq("employee_key", d.employeeKey);
        if (e) throw new Error(e.message);
      }
    } catch (e) {
      outcome = "error";
      error = e instanceof Error ? e.message : "Unknown error";
    }
    // Skipped submissions without an ID can't be logged (the ID is the key).
    if (a.submissionId) {
      const reason = [error, ...d.notes, d.differences.length ? `AOS has a different ${d.differences.join(" and ")}` : ""].filter(Boolean).join("; ") || null;
      const { error: logErr } = await supabaseAdmin.from("jotform_application_log").upsert({
        submission_id: a.submissionId, submitted_at: `${a.submittedOn}T12:00:00Z`, received_at: new Date().toISOString(),
        via, outcome, match_reason: d.matchReason, employee_key: d.employeeKey, reason,
        application: logSummary(a), before, after: d.write,
      }, { onConflict: "submission_id" });
      if (logErr && !error) { error = `Saved, but the log failed: ${logErr.message}`; }
    }
    report.push({ ...row, outcome, notes: error ? [error, ...d.notes] : d.notes });
  }
  return report;
}
