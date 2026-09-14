// Interim audit lines on a job's Notes (round 3, #98 / #92).
//
// There is no audit trail in AOS yet — that is its own project (#108). Until it
// exists, actions that need a "who, when, why" record append ONE line to the
// job's Notes. John chose this (2026-09-13) because Notes lock once a job
// leaves Lead, which is exactly where these actions happen.
//
// The line is written with a targeted UPDATE of job_requests.notes — never
// through the job header's Save — so a job screen holding older data can't be
// the thing that writes it.
//
// ⚠ Known limits, accepted for the interim: the in-memory job cache is not
// refreshed (the job screen shows the new line after a reload), and flipping a
// job back to Lead makes Notes editable again.

import { supabase } from "@/lib/supabase/client";

/** "[2026-09-13 3:40 PM · John O'Brien] <text>". Pure — unit-tested. */
export function formatAuditLine(at: Date, who: string, text: string): string {
  const y = at.getFullYear();
  const mo = String(at.getMonth() + 1).padStart(2, "0");
  const d = String(at.getDate()).padStart(2, "0");
  const h24 = at.getHours();
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  const mm = String(at.getMinutes()).padStart(2, "0");
  const mer = h24 >= 12 ? "PM" : "AM";
  const name = who.trim() || "unknown user";
  return `[${y}-${mo}-${d} ${h12}:${mm} ${mer} · ${name}] ${text.replace(/\s+/g, " ").trim()}`;
}

/** Append a line to existing notes text, one line per entry. Pure — unit-tested. */
export function appendNoteLine(existing: string | null | undefined, line: string): string {
  const base = (existing ?? "").replace(/\s+$/, "");
  return base ? `${base}\n${line}` : line;
}

async function currentUserName(): Promise<string> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return "unknown user";
  const { data } = await supabase.from("profiles").select("full_name, email").eq("id", user.id).maybeSingle();
  return (data as any)?.full_name || (data as any)?.email || user.email || "unknown user";
}

/**
 * Append an audit line to a job's Notes. Returns an error message, or null on
 * success. Callers should surface a failure — the action it records has
 * already happened, and the record of it is the point.
 */
export async function appendJobAuditLine(jobRequestId: string, text: string): Promise<string | null> {
  try {
    const who = await currentUserName();
    const line = formatAuditLine(new Date(), who, text);
    const { data, error } = await supabase.from("job_requests").select("notes").eq("id", jobRequestId).maybeSingle();
    if (error) return error.message;
    if (!data) return "job not found";
    const { error: upErr } = await supabase
      .from("job_requests")
      .update({ notes: appendNoteLine((data as any).notes, line) })
      .eq("id", jobRequestId);
    return upErr ? upErr.message : null;
  } catch (e: any) {
    return e?.message ?? String(e);
  }
}
