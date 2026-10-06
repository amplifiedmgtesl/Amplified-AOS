// Job-completeness checks. These cover the gaps in the job_request itself
// (days, crew needs, shifts, assignments, requirements text) that block
// downstream quote/timekeeping/payroll flows.

import type { CheckFn, Finding } from "../types";

export const jobCompletenessChecks: CheckFn[] = [
  // 1. Header date range matches day rows (replaces the existing inline warning)
  (ctx) => {
    if (ctx.days.length === 0) return [];
    const sorted = [...ctx.days].map((d) => d.eventDate).sort();
    const minDay = sorted[0];
    const maxDay = sorted[sorted.length - 1];
    const start = ctx.jobRequest.requestDate;
    const end = ctx.jobRequest.endDate || ctx.jobRequest.requestDate;
    const issues: string[] = [];
    if (minDay < start) issues.push(`Day row on ${minDay} is before header start (${start}).`);
    if (maxDay > end) issues.push(`Day row on ${maxDay} is after header end (${end}).`);
    if (!issues.length) return [];
    return [{
      id: "job.header_days_mismatch",
      severity: "warning",
      category: "job",
      title: "Header dates don't match day rows",
      detail: issues.join(" "),
      downstream: "Calendar exports and reporting use the header range — days outside it may be hidden.",
    }];
  },

  // 2. At least one day exists
  (ctx) => {
    if (ctx.days.length > 0) return [];
    return [{
      id: "job.no_days",
      severity: "blocker",
      category: "job",
      title: "No days defined on this job",
      detail: "The Daily Requirements tab is empty.",
      downstream: "Nothing to quote, no crew to schedule, no timekeeping anchor.",
      fixLabel: "Add days on the Daily Requirements tab",
    }];
  },

  // 3. Every day has at least one crew need
  (ctx) => {
    const findings: Finding[] = [];
    const byDay = new Map<string, number>();
    for (const n of ctx.crewNeeds) {
      byDay.set(n.jobRequestDayId, (byDay.get(n.jobRequestDayId) ?? 0) + (n.quantity || 0));
    }
    for (const d of ctx.days) {
      if (!byDay.get(d.id)) {
        findings.push({
          id: `job.no_crew_needs:${d.id}`,
          severity: "warning",
          category: "job",
          title: `No crew needs on ${d.eventDate}`,
          detail: "The day has no positions/quantities defined.",
          downstream: "Quote lines for this day can't auto-generate; assignments have no slots to fill.",
          fixLabel: "Add crew needs on the Daily Requirements tab",
        });
      }
    }
    return findings;
  },

  // 4. Shifts defined (replaces the existing inline warning)
  (ctx) => {
    if (ctx.shifts.length > 0) return [];
    return [{
      id: "job.no_shifts",
      severity: "warning",
      category: "job",
      title: "No shifts defined on this job",
      detail: "Multi-shift days (morning call + load-out) can't get separate 5-hour minimums in payroll.",
      downstream: "Payroll groups by position instead of by shift. OK for single-shift jobs; wrong for multi-shift.",
      fixLabel: "Set up shifts on the Shifts tab",
    }];
  },

  // 5. Assignments cover crew_needs
  (ctx) => {
    const findings: Finding[] = [];
    // Sum quantity by (day, position, specialty, shift)
    const needKey = (n: { jobRequestDayId: string; positionId?: string; specialtyId?: string; shiftId?: string }) =>
      `${n.jobRequestDayId}|${n.positionId ?? ""}|${n.specialtyId ?? ""}|${n.shiftId ?? ""}`;
    const needBy = new Map<string, number>();
    for (const n of ctx.crewNeeds) {
      needBy.set(needKey(n), (needBy.get(needKey(n)) ?? 0) + (n.quantity || 0));
    }
    const assignBy = new Map<string, number>();
    for (const a of ctx.assignments) {
      if (!a.employeeKey) continue;   // an open spot isn't a filled one
      assignBy.set(needKey(a), (assignBy.get(needKey(a)) ?? 0) + 1);
    }
    const dayDateById = new Map(ctx.days.map((d) => [d.id, d.eventDate] as const));
    const specName = new Map(ctx.specialties.map((s) => [s.id, s.name] as const));
    for (const [key, needed] of needBy) {
      const filled = assignBy.get(key) ?? 0;
      if (filled >= needed) continue;
      const [dayId, , specId] = key.split("|");
      const dayDate = dayDateById.get(dayId) ?? dayId;
      const label = specId ? specName.get(specId) ?? specId : "(unspecialized)";
      findings.push({
        id: `job.under_assigned:${key}`,
        severity: "warning",
        category: "job",
        title: `Under-staffed: ${dayDate} · ${label}`,
        detail: `${filled} of ${needed} crew assigned.`,
        downstream: "Day will go into call with empty slots — operator needs to fill before showtime.",
        fixHref: `/job-requests/${encodeURIComponent(ctx.jobRequest.id)}?tab=crew`,
        fixLabel: "Assign crew on the Assigned Crew tab",
      });
    }
    return findings;
  },

  // 6. Every day has a time window (#38)
  //
  // A day with no start/end times can't print its schedule or sign-in sheet,
  // is skipped by "Add Crew from Job", and gives the Time Clock and Assigned
  // Crew nothing to show as planned. With crew already assigned that is a
  // BLOCKER (category "crew", so it never gates issuing a quote). Without
  // crew it stays a warning — leads legitimately exist before the schedule
  // is known (John's call), and a hard rule just invites fake times.
  (ctx) => {
    const findings: Finding[] = [];
    const assignedDayIds = new Set(ctx.assignments.filter((a) => a.employeeKey).map((a) => a.jobRequestDayId));
    for (const d of ctx.days) {
      if (d.startTime || d.endTime || d.startTime2 || d.endTime2) continue;
      const hasCrew = assignedDayIds.has(d.id);
      findings.push({
        id: `job.day_no_time_window:${d.id}`,
        severity: hasCrew ? "blocker" : "warning",
        category: hasCrew ? "crew" : "job",
        title: `No start/end times on ${d.eventDate}`,
        detail: hasCrew
          ? "Crew are assigned to this day but it has no start or end time."
          : "The day has no start or end time yet.",
        downstream:
          "The crew schedule and sign-in sheet for this day won't print, Add Crew from Job skips it, "
          + "and nobody has planned times.",
        fixHref: `/job-requests/${encodeURIComponent(ctx.jobRequest.id)}?tab=daily`,
        fixLabel: "Set start/end times on the Daily Requirements tab",
      });
    }
    return findings;
  },
];
