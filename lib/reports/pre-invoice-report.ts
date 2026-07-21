/**
 * Pre-Invoice Client Report builder (#12, 2026-07-21).
 *
 * Summarizes a job's timekeeping records the way the eventual invoice will
 * read, but split one level finer: within each invoice grouping tuple
 * (day, position, specialty, shift, holiday), workers with IDENTICAL times
 * (both in/out pairs + both meal breaks) group onto one line. So a day shows
 * "12 Stagehands 8:00a–5:00p" and "3 Stagehands 3:00p–5:00p" as separate
 * lines, each priced exactly as the invoice pull would price its hours.
 *
 * Pricing is the SAME engine as overwriteFromTimesheets — shared module
 * lib/rates/timesheet-group-pricing.ts (rate card bill rates + the quote's
 * day-vs-hourly hints), so report totals match the invoice the client will
 * eventually receive (for the approved subset).
 *
 * Deliberate differences from the invoice pull:
 *   - ALL statuses included (admin-created, submitted, approved, rejected),
 *     per John 2026-07-21 — lines carry status counts so the view can mark
 *     lines containing not-yet-approved time.
 *   - No invoice required — reads entries by job_id and resolves the quote
 *     hints from the job's active issued quote (falling back to the open
 *     draft, matching what a future final invoice would use as its source).
 *   - No dedupe against already-billed entries: this is a summary of ALL
 *     timekeeping for the job, not an incremental pull.
 *   - Read-only: never writes lines, never back-links entries.
 */

import { supabase } from "@/lib/supabase/client";
import { resolveRateCardForJob, loadJobQuoteState } from "@/lib/store/quotes";
import type { QuoteLine } from "@/lib/store/types";
import {
  loadQuoteRateHints,
  buildBillRateMap,
  priceTimesheetGroup,
  type QuoteRateHint,
} from "@/lib/rates/timesheet-group-pricing";

export type PreInvoiceReportLine = {
  /** Priced invoice-style line (same shape the draft editor uses). */
  line: QuoteLine;
  /** Display time block. Pair 2 present only when used. */
  timeIn1: string;
  timeOut1: string;
  timeIn2: string;
  timeOut2: string;
  mealBreak1Minutes: number;
  mealBreak2Minutes: number;
  /** Entry statuses inside this line: status → count. Key "admin" stands in
   *  for NULL (admin-created rows have no approval workflow). */
  statusCounts: Record<string, number>;
  /** True when any entry on the line is submitted/rejected — i.e. time that
   *  could still change before invoicing. Drives the footnote marker. */
  hasPendingTime: boolean;
  entryIds: string[];
};

export type PreInvoiceReportDay = {
  date: string;          // YYYY-MM-DD
  isHoliday: boolean;    // any line on the day is holiday-flagged
  lines: PreInvoiceReportLine[];
  subtotal: number;
};

export type PreInvoiceReport = {
  jobId: string;
  days: PreInvoiceReportDay[];
  grandTotal: number;
  totalEntries: number;
  /** Quote used for day-vs-hourly rate hints (null = none; all lines hourly). */
  hintQuoteId: string | null;
  holidayMultiplier: number;
  warnings: {
    /** Entries with no position FK — excluded from the report (same rule as
     *  the invoice pull). Shown on screen, never in the printed PDF. */
    skippedNoPosition: Array<{ entryId: string; detail: string }>;
    /** Lines whose specialty has no rate-card row — printed at $0. */
    missingRates: string[];
    /** No rate card resolved at all — every line is $0. */
    noRateCard: boolean;
    /** Entries with zero recorded hours — excluded from the report (a
     *  billing preview has nothing to say about them; typically blank
     *  placeholder rows left in the timekeeping grid). */
    zeroHourExcluded: number;
  };
};

type EntryRow = {
  id: string;
  work_date: string | null;
  end_date: string | null;
  position: string | null;
  position_id: string | null;
  specialty_id: string | null;
  shift_id: string | null;
  employee_key: string | null;
  time_in1: string | null;
  time_out1: string | null;
  time_in2: string | null;
  time_out2: string | null;
  meal_break_1_minutes: number | null;
  meal_break_2_minutes: number | null;
  std_hours: number | null;
  ot_hours: number | null;
  dt_hours: number | null;
  total_hours: number | null;
  is_holiday: boolean | null;
  status: string | null;
};

type ReportGroup = {
  workDate: string;
  endDate: string | null;
  positionId: string | null;
  positionText: string;
  specialtyId: string | null;
  shiftId: string | null;
  isHoliday: boolean;
  timeIn1: string;
  timeOut1: string;
  timeIn2: string;
  timeOut2: string;
  mealBreak1Minutes: number;
  mealBreak2Minutes: number;
  stdHours: number;
  otHours: number;
  dtHours: number;
  entryIds: string[];
  workerKeys: Set<string>;
  workerTotalHours: Map<string, number>;
  statusCounts: Record<string, number>;
};

/** Status bucket for grouping/labels. NULL status = admin-created. */
function statusBucket(s: string | null): string {
  return s ?? "admin";
}

export async function buildPreInvoiceReport(jobId: string): Promise<PreInvoiceReport> {
  // ─── 1. All timekeeping entries for the job, live (never the startup
  //        cache — raw job data, per the 2026-07-02 cache principle).
  //        ALL statuses, unlike the invoice pull's approved-only read.
  const entriesRes = await supabase
    .from("timesheet_entries")
    .select(`
      id, work_date, end_date,
      position, position_id, specialty_id, shift_id,
      employee_key,
      time_in1, time_out1, time_in2, time_out2,
      meal_break_1_minutes, meal_break_2_minutes,
      std_hours, ot_hours, dt_hours, total_hours,
      is_holiday, status
    `)
    .eq("job_id", jobId);
  if (entriesRes.error) throw entriesRes.error;
  const entries = (entriesRes.data ?? []) as EntryRow[];

  // ─── 2. Rates: same resolution the invoice pull uses.
  const rateCard = await resolveRateCardForJob(jobId);
  const billRateBySpecialty = buildBillRateMap(rateCard?.rows ?? []);
  const holidayMultiplier = rateCard?.holidayMultiplier ?? 2.0;

  // ─── 3. Quote hints: a final invoice's sourceQuoteId is the issued quote
  //        it was generated from — mirror that. Fall back to the open draft
  //        so pre-quote-issue reports still price day-rate days correctly.
  const quoteState = await loadJobQuoteState(jobId);
  const hintQuoteId = quoteState.latestIssuedId ?? quoteState.openDraftId ?? null;
  const quoteRateHintByKey: Map<string, QuoteRateHint> = hintQuoteId
    ? await loadQuoteRateHints(hintQuoteId)
    : new Map();

  // ─── 4. Group by the invoice 5-tuple + the time signature.
  const skippedNoPosition: PreInvoiceReport["warnings"]["skippedNoPosition"] = [];
  const groups = new Map<string, ReportGroup>();
  let zeroHourExcluded = 0;
  for (const e of entries) {
    // Zero-hour entries (blank placeholder rows in the grid) have nothing
    // to bill — excluding them keeps phantom "(no date)" days and dash
    // lines off the client-facing report. Counted for the on-screen warning.
    const hasHours =
      Number(e.total_hours ?? 0) !== 0 ||
      Number(e.std_hours ?? 0) !== 0 ||
      Number(e.ot_hours ?? 0) !== 0 ||
      Number(e.dt_hours ?? 0) !== 0;
    if (!hasHours) {
      zeroHourExcluded++;
      continue;
    }
    if (!e.position_id) {
      // Same integrity rule as the invoice pull: no position FK → the line
      // can't resolve a rate card row or print a position name. Surface it
      // on screen instead of silently producing a malformed line.
      const detail = `Position text was "${e.position ?? ""}" on ${e.work_date ?? "(no date)"}. Fix the entry in Timekeeping, then regenerate.`;
      skippedNoPosition.push({ entryId: e.id, detail });
      continue;
    }
    const timeSig = [
      e.time_in1 ?? "", e.time_out1 ?? "",
      e.time_in2 ?? "", e.time_out2 ?? "",
      Number(e.meal_break_1_minutes ?? 0),
      Number(e.meal_break_2_minutes ?? 0),
    ].join("~");
    const key = [
      e.work_date ?? "",
      e.position_id,
      e.specialty_id ?? "",
      e.shift_id ?? "",
      e.is_holiday ? "h" : "n",
      timeSig,
    ].join("|");
    const workerKey = e.employee_key ?? `entry-${e.id}`;
    const entryTotalHours = Number(e.total_hours ?? 0);
    const bucket = statusBucket(e.status);
    const g = groups.get(key);
    if (g) {
      g.stdHours += Number(e.std_hours ?? 0);
      g.otHours  += Number(e.ot_hours  ?? 0);
      g.dtHours  += Number(e.dt_hours  ?? 0);
      g.entryIds.push(e.id);
      g.workerKeys.add(workerKey);
      g.workerTotalHours.set(workerKey, (g.workerTotalHours.get(workerKey) ?? 0) + entryTotalHours);
      g.statusCounts[bucket] = (g.statusCounts[bucket] ?? 0) + 1;
      if (e.end_date && (!g.endDate || e.end_date > g.endDate)) g.endDate = e.end_date;
    } else {
      groups.set(key, {
        workDate: e.work_date ?? "",
        endDate: e.end_date ?? null,
        positionId: e.position_id,
        positionText: e.position ?? "",
        specialtyId: e.specialty_id ?? null,
        shiftId: e.shift_id ?? null,
        isHoliday: !!e.is_holiday,
        timeIn1: e.time_in1 ?? "",
        timeOut1: e.time_out1 ?? "",
        timeIn2: e.time_in2 ?? "",
        timeOut2: e.time_out2 ?? "",
        mealBreak1Minutes: Number(e.meal_break_1_minutes ?? 0),
        mealBreak2Minutes: Number(e.meal_break_2_minutes ?? 0),
        stdHours: Number(e.std_hours ?? 0),
        otHours:  Number(e.ot_hours  ?? 0),
        dtHours:  Number(e.dt_hours  ?? 0),
        entryIds: [e.id],
        workerKeys: new Set([workerKey]),
        workerTotalHours: new Map([[workerKey, entryTotalHours]]),
        statusCounts: { [bucket]: 1 },
      });
    }
  }

  // ─── 5. Price each group with the shared engine and assemble days.
  //        Sort: date → shift → position → start time.
  const sorted = Array.from(groups.values()).sort((a, b) => {
    if (a.workDate !== b.workDate) return a.workDate.localeCompare(b.workDate);
    const aShift = a.shiftId ?? ""; const bShift = b.shiftId ?? "";
    if (aShift !== bShift) return aShift.localeCompare(bShift);
    const pos = (a.positionText || "").localeCompare(b.positionText || "");
    if (pos !== 0) return pos;
    return a.timeIn1.localeCompare(b.timeIn1);
  });

  const missingRates: string[] = [];
  const dayByDate = new Map<string, PreInvoiceReportDay>();
  for (const g of sorted) {
    const rate = g.specialtyId ? billRateBySpecialty.get(g.specialtyId) : undefined;
    const hintKey = (g.workDate && g.specialtyId) ? `${g.workDate}|${g.specialtyId}` : null;
    const hint = hintKey ? quoteRateHintByKey.get(hintKey) : undefined;
    const { line, missingRate } = priceTimesheetGroup(
      {
        workDate: g.workDate,
        endDate: g.endDate,
        positionId: g.positionId,
        positionText: g.positionText,
        specialtyId: g.specialtyId,
        shiftId: g.shiftId,
        isHoliday: g.isHoliday,
        stdHours: g.stdHours,
        otHours: g.otHours,
        dtHours: g.dtHours,
        crewCount: g.workerKeys.size,
        workerTotalHours: g.workerTotalHours,
      },
      { rate, hint, holidayMultiplier },
    );
    if (missingRate) {
      missingRates.push(`No rate-card row for "${g.positionText}" on ${g.workDate} — printed at $0.`);
    }
    const hasPendingTime = Object.keys(g.statusCounts).some(
      (s) => s !== "approved" && s !== "admin",
    );
    const reportLine: PreInvoiceReportLine = {
      line,
      timeIn1: g.timeIn1, timeOut1: g.timeOut1,
      timeIn2: g.timeIn2, timeOut2: g.timeOut2,
      mealBreak1Minutes: g.mealBreak1Minutes,
      mealBreak2Minutes: g.mealBreak2Minutes,
      statusCounts: g.statusCounts,
      hasPendingTime,
      entryIds: g.entryIds,
    };
    const date = g.workDate || "(no date)";
    const day = dayByDate.get(date);
    if (day) {
      day.lines.push(reportLine);
      day.subtotal = +(day.subtotal + line.total).toFixed(2);
      day.isHoliday = day.isHoliday || g.isHoliday;
    } else {
      dayByDate.set(date, {
        date,
        isHoliday: g.isHoliday,
        lines: [reportLine],
        subtotal: line.total,
      });
    }
  }

  const days = Array.from(dayByDate.values()).sort((a, b) => a.date.localeCompare(b.date));
  const grandTotal = +days.reduce((s, d) => s + d.subtotal, 0).toFixed(2);

  return {
    jobId,
    days,
    grandTotal,
    totalEntries: entries.length,
    hintQuoteId,
    holidayMultiplier,
    warnings: {
      skippedNoPosition,
      missingRates,
      noRateCard: !rateCard,
      zeroHourExcluded,
    },
  };
}
