// Onboarding screen: filters and the CSV export (Connor's feedback, 2026-10-27).
//
// Pure: the page passes the one combined list (people on a job, then
// applicants), the Paychex matches it has looked up, and today. No network.

import { addDays, type OnboardingRow, type PaychexMatch } from "./plan";

export type JobFilter = "" | "on" | "off";
export type WhenFilter = "" | "past7" | "past14" | "past30" | "ahead";
export type MissingFilter = "" | "email" | "phone" | "either" | "none";
export type PaychexFilter = "" | "notSent" | "waiting" | "found" | "notFound";

export type OnbFilters = {
  search: string;
  job: JobFilter;
  when: WhenFilter;
  missing: MissingFilter;
  paychex: PaychexFilter;
};

export const NO_FILTERS: OnbFilters = { search: "", job: "", when: "", missing: "", paychex: "" };

/** On a job = a confirmed crew day or timesheet in the 30-day window. */
export const onJob = (r: OnboardingRow) => !!(r.firstWorked || r.nextBooked);

const hasEmail = (r: OnboardingRow) => !!(r.email ?? "").trim();
const hasPhone = (r: OnboardingRow) => !!(r.phone ?? "").trim();

export function missingLabel(r: OnboardingRow): string {
  return [hasEmail(r) ? "" : "email", hasPhone(r) ? "" : "phone"].filter(Boolean).join(", ");
}

/** Where they are with Paychex. `matches` undefined = not looked up yet. */
export function paychexState(r: OnboardingRow, matches: PaychexMatch[] | undefined): string {
  if (r.paychexInvitedAt || r.paychexWorkerId) return "Sent, waiting";
  if (!matches) return "Not checked";
  return matches.length ? "Possible match in Paychex" : "Not sent";
}

/** The newest date we know for them: last worked, else applied. */
const pastDate = (r: OnboardingRow) => r.lastWorked?.date ?? (onJob(r) ? null : r.appliedAt ?? null);

export function matchesFilters(
  r: OnboardingRow, f: OnbFilters, matches: PaychexMatch[] | undefined, today: string,
): boolean {
  const q = f.search.trim().toLowerCase();
  if (q && !`${r.name} ${r.email} ${r.phone} ${r.firstWorked?.jobName ?? ""} ${r.nextBooked?.jobName ?? ""}`.toLowerCase().includes(q)) return false;

  if (f.job === "on" && !onJob(r)) return false;
  if (f.job === "off" && onJob(r)) return false;

  if (f.when === "ahead" && !r.nextBooked) return false;
  if (f.when.startsWith("past") && today) {
    const d = pastDate(r);
    if (!d || d < addDays(today, -Number(f.when.slice(4)))) return false;
  }

  if (f.missing === "email" && hasEmail(r)) return false;
  if (f.missing === "phone" && hasPhone(r)) return false;
  if (f.missing === "either" && hasEmail(r) && hasPhone(r)) return false;
  if (f.missing === "none" && !(hasEmail(r) && hasPhone(r))) return false;

  const sent = !!(r.paychexInvitedAt || r.paychexWorkerId);
  if (f.paychex === "waiting" && !sent) return false;
  if (f.paychex === "notSent" && sent) return false;
  // Found / not found need the lookup; until it's back nobody qualifies.
  if (f.paychex === "found" && (sent || !matches?.length)) return false;
  if (f.paychex === "notFound" && (sent || !matches || matches.length)) return false;
  return true;
}

// ── CSV for the coordinators ────────────────────────────────────────────────

function cell(v: string | number): string {
  const s = String(v ?? "");
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const COLS = [
  "Name", "Type", "Email", "Phone", "Missing", "On a job",
  "First worked", "Last worked", "Job", "Hours", "Next booked", "Next job",
  "Applied", "Applied for", "Paychex", "Possible duplicate",
];

export function onboardingCsv(rows: OnboardingRow[], px: Record<string, PaychexMatch[]> | null): string {
  const lines = [COLS.join(",")];
  for (const r of rows) {
    lines.push([
      r.name,
      r.employmentType === "Employee" ? "Employee (W-2)" : "Contractor (1099)",
      r.email, r.phone, missingLabel(r), onJob(r) ? "Yes" : "No",
      r.firstWorked?.date ?? "", r.lastWorked?.date ?? "",
      r.firstWorked?.jobName ?? "", r.hours || "",
      r.nextBooked?.date ?? "", r.nextBooked?.jobName ?? "",
      r.appliedAt ?? "", r.appliedPosition ?? "",
      paychexState(r, px?.[r.employeeKey]),
      r.duplicates.length ? r.duplicates.map((d) => d.name).join("; ") : "",
    ].map(cell).join(","));
  }
  // Excel opens a UTF-8 CSV correctly only with the byte-order mark.
  return "﻿" + lines.join("\r\n") + "\r\n";
}

export function onboardingCsvFilename(today: string): string {
  return `Onboarding — ${today}.csv`;
}
