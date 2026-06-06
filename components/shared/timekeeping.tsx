
"use client";

import { Fragment, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { printWithTitle } from "@/lib/print-with-title";
import {
  getActiveJob, setActiveJob,
  loadJobRequests, loadJobSheets, loadTimesheets,
  getTimesheetByJobId, getTimesheetByJobSheetId,
  ensureTimesheetForJobRequest,
  upsertTimesheet, positionNames, loadEmployees, loadPositions, loadSpecialties,
  upsertEmployee,
  getPendingStaffEntriesByJobId,
  approveStaffEntry, rejectStaffEntry, setEntryApproved, setEntrySubmitted,
} from "@/lib/store/app-store";
import { loadJobCrewSlots } from "@/lib/storage/job-request-assignments";
import { blankTimeEntry, computeTimeEntry, mealBreakOptions, rateOptions, summarizeTimesheet, timeOptions } from "@/lib/store/timekeeping";
import { parseMinutes } from "@/lib/time-utils";
import type { EmployeeRecord, JobRequest, JobSheet, TimeEntry, Timesheet } from "@/lib/store/types";
import { EqualizerLoader } from "@/components/shared/equalizer-loader";
import { EmployeePicker, LazyEmployeePicker, pushEmployeeIntoCache, type PickerEmployee } from "@/components/shared/employee-picker";

// Phase 1: picker selection encodes which world we're in.
//   "job:<jobId>"        — canonical, anchored on job_requests
//   "legacy:<jobSheetId>" — pre-rewrite timesheet whose job_id couldn't be backfilled
type PickerValue = "" | `job:${string}` | `legacy:${string}`;

function parsePicker(v: PickerValue): { kind: "none" | "job" | "legacy"; key: string } {
  if (!v) return { kind: "none", key: "" };
  if (v.startsWith("job:")) return { kind: "job", key: v.slice(4) };
  return { kind: "legacy", key: v.slice(7) };
}

/** Map rate-card TriggerOption text → integer hour threshold for the
 *  per-entry snapshot. "none"/""/"weekly40" → 0 (no bucket); numeric
 *  strings parse as the threshold; anything unrecognized → null = let
 *  computeTimeEntry use its legacy default. */
function triggerToInt(v: string | null | undefined): number | null {
  if (v == null) return null;
  if (v === "none" || v === "" || v === "weekly40") return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

const TIMES = timeOptions();
const RATES = rateOptions();
// POSITIONS is loaded from the store at render time so it stays live

/**
 * Lazy time-of-day select. At rest it's a plain text cell ("08:00" or blank);
 * on click it mounts the full <select> with all 288 5-minute slots. Same
 * pattern as LazyEmployeePicker — for a 525-row print, the at-rest text
 * IS the print value and the heavy option list never materializes.
 *
 * Saves ~600,000 <option> DOM nodes on a Carolina-sized expanded timesheet.
 */
function LazyTimeSelect({
  value,
  options,
  onChange,
  disabled,
  ariaLabel,
}: {
  value: string;
  options: string[];
  onChange: (v: string) => void;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  const [active, setActive] = useState(false);
  if (active) {
    return (
      <select
        className="input-tight"
        autoFocus
        aria-label={ariaLabel}
        value={value}
        disabled={disabled}
        onChange={(e) => { onChange(e.target.value); setActive(false); }}
        onBlur={() => setActive(false)}
        style={{ minWidth: 80 }}
      >
        {options.map((t) => <option key={t} value={t}>{t === "" ? "— clear —" : t}</option>)}
      </select>
    );
  }
  return (
    <div
      onClick={() => { if (!disabled) setActive(true); }}
      className="hide-print"
      style={{
        cursor: disabled ? "default" : "pointer",
        padding: "3px 6px",
        border: "1px solid var(--line, #d7c6aa)",
        borderRadius: 4,
        background: "#fff",
        fontSize: 12,
        minWidth: 60,
        textAlign: "center",
      }}
      aria-label={ariaLabel}
      title={disabled ? "" : "Click to set time"}
    >
      {value || <span style={{ color: "#bbb" }}>—</span>}
    </div>
  );
}

function splitName(fullName: string) {
  const parts = fullName.trim().split(" ");
  return { firstName: parts[0] || "", lastName: parts.slice(1).join(" ") || "" };
}

// ─── Dev-only perf logger ────────────────────────────────────────────────────
// Captures timestamps + arbitrary data through the load lifecycle so we can
// see exactly where the wall-clock seconds are going. No-op in production.
// Read the captured trace from the console with `window.__tkPerf`.
const TK_PERF_ON = typeof process !== "undefined"
  && process.env.NEXT_PUBLIC_VERCEL_ENV !== "production";
type TkPerfEvent = { t: number; dt: number; label: string; data?: any };
function tkPerf(label: string, data?: any) {
  if (!TK_PERF_ON) return;
  if (typeof window === "undefined") return;
  const w = window as any;
  const now = performance.now();
  if (!w.__tkPerf) w.__tkPerf = [] as TkPerfEvent[];
  const arr: TkPerfEvent[] = w.__tkPerf;
  const last = arr.length ? arr[arr.length - 1].t : now;
  const evt: TkPerfEvent = { t: now, dt: Math.round(now - last), label, data };
  arr.push(evt);
  // Compact console line so it shows up in the live log too.
  // eslint-disable-next-line no-console
  console.log(`[tk-perf +${evt.dt}ms] ${label}`, data ?? "");
}
function tkPerfReset(reason: string) {
  if (!TK_PERF_ON || typeof window === "undefined") return;
  (window as any).__tkPerf = [];
  tkPerf(`▶ reset: ${reason}`);
}
// Downloadable trace — triggers a Save As dialog so we get a real OS file.
// Callable from the console (`window.__tkPerfDownload()`) or from the
// "📥 perf log" link rendered in the header below.
function tkPerfDownload(filename?: string) {
  if (!TK_PERF_ON || typeof window === "undefined") return;
  const arr: TkPerfEvent[] = (window as any).__tkPerf ?? [];
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const name = filename ?? `tk-perf-${ts}.json`;
  const body = JSON.stringify({
    capturedAt: new Date().toISOString(),
    userAgent: navigator.userAgent,
    href: location.href,
    eventCount: arr.length,
    events: arr,
  }, null, 2);
  const blob = new Blob([body], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  // eslint-disable-next-line no-console
  console.log(`[tk-perf] downloaded ${name} (${arr.length} events)`);
}
if (TK_PERF_ON && typeof window !== "undefined") {
  (window as any).__tkPerfDownload = tkPerfDownload;
}

export default function Timekeeping({ hideBillAlways = false }: { hideBillAlways?: boolean }) {
  const POSITIONS = positionNames();
  // Phase 3: master tables for cascading Position → Specialty selects.
  // Loaded once and shared across rows.
  const allPositions = useMemo(() => loadPositions().filter((p) => p.isActive !== false), []);
  const allSpecialties = useMemo(() => loadSpecialties().filter((s) => s.isActive !== false), []);
  const positionNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of allPositions) m.set(p.id, p.name);
    return m;
  }, [allPositions]);
  const specialtyNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of allSpecialties) m.set(s.id, s.name);
    return m;
  }, [allSpecialties]);
  // For a given positionId, the valid specialties. Used to populate the
  // Specialty dropdown and to invalidate an obsolete specialty selection
  // when the user changes Position.
  function specialtiesFor(positionId: string | null | undefined) {
    if (!positionId) return [];
    return allSpecialties.filter((s) => s.positionId === positionId);
  }
  /** Set of positionIds that have at least one specialty defined in the
   *  master. Used by the approval gate to skip the specialty requirement
   *  for positions where no choice exists (e.g. office-only roles). */
  const positionsRequiringSpecialty = useMemo(() => {
    const s = new Set<string>();
    for (const sp of allSpecialties) if (sp.positionId) s.add(sp.positionId);
    return s;
  }, [allSpecialties]);
  function requiresSpecialty(positionId: string | null | undefined): boolean {
    return !!positionId && positionsRequiringSpecialty.has(positionId);
  }
  const [refreshKey, setRefreshKey] = useState(0);
  const sheets = useMemo(() => loadJobSheets(), [refreshKey]);
  const jobRequests = useMemo(() => loadJobRequests(), [refreshKey]);
  const timesheets = useMemo(() => loadTimesheets(), [refreshKey]);
  // NOTE: the legacy in-memory `employees` array used to be passed to the
  // per-row autofill. That's been replaced by the EmployeePicker pattern
  // (module-level cache in employee-picker.tsx), so we no longer need to
  // memoize the full directory here. `loadEmployees()` is still called
  // inline by addCrewFromJob() for one-off name lookups.
  const [pendingEntries, setPendingEntries] = useState<import("@/lib/store/types").TimeEntry[]>([]);

  // Picker state — encodes both kinds of selection (canonical job vs. legacy job_sheet).
  // Initial value: prefer the last picked job (Phase 1 sticky state). If none, default
  // to the most recent job_request that already has a timesheet linked to it.
  const initialPicker: PickerValue = (() => {
    const lastJobId = getActiveJob();
    if (lastJobId && jobRequests.some((j) => j.id === lastJobId)) return `job:${lastJobId}`;
    const firstLinked = timesheets.find((t) => t.jobId);
    if (firstLinked?.jobId) return `job:${firstLinked.jobId}`;
    const firstLegacy = timesheets.find((t) => !t.jobId);
    if (firstLegacy?.jobSheetId) return `legacy:${firstLegacy.jobSheetId}`;
    return "";
  })();
  const [picker, setPicker] = useState<PickerValue>(initialPicker);
  const { kind: pickerKind, key: pickerKey } = parsePicker(picker);
  // True between the user picking a new job and the new timesheet finishing
  // its first heavy render. Without this, React batches setPicker +
  // setTimesheet into one render, so the loading overlay never paints between
  // the click and the (slow) re-render of the new timesheet's 400+ rows.
  const [isSwitchingJob, setIsSwitchingJob] = useState(false);
  /** Defer the picker update so the spinner gets a paint frame first. */
  function changePicker(next: PickerValue) {
    if (next === picker) return;
    tkPerfReset(`changePicker → ${next}`);
    setIsSwitchingJob(true);
    tkPerf("setIsSwitchingJob(true) called");
    // Two RAFs guarantees the overlay paints before the heavy render starts.
    requestAnimationFrame(() => {
      tkPerf("RAF #1 fired");
      requestAnimationFrame(() => {
        tkPerf("RAF #2 fired → setPicker(next)");
        setPicker(next);
      });
    });
  }

  const [timesheet, setTimesheet] = useState<Timesheet | null>(null);
  const [dayFilter, setDayFilter] = useState<string>("all");
  // Bulk selection (admin only — gated on !hideBillAlways at render time).
  // Cleared whenever the picker switches timesheets so we never act on
  // entries from a different job.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [busyBatch, setBusyBatch] = useState<null | "approve" | "reject" | "delete">(null);
  // Clear selection on timesheet swap.
  useEffect(() => { setSelectedIds(new Set()); }, [timesheet?.id]);
  // Per-day collapse state on the editing view. Print mode forces all expanded
  // (via @media print) and hides the day-separator header rows.
  //
  // Stored as user OVERRIDES, not the absolute state — keyed by day with an
  // explicit boolean. The default (`dayGroups.length > 1` → all collapsed) is
  // applied inline by `isDayCollapsed()` whenever a day isn't in the map.
  // This avoids the prior bug where a useEffect set the collapse AFTER the
  // first render, so the first paint always rendered every row in every day —
  // catastrophic on big jobs like the 525-row Ohio Country Fest.
  const [collapsedOverrides, setCollapsedOverrides] = useState<Map<string, boolean>>(new Map());
  // Reset overrides when the active timesheet changes — fresh job, fresh defaults.
  useEffect(() => { setCollapsedOverrides(new Map()); }, [timesheet?.id]);
  // Convenience alias for the in-memory rows of the active timesheet.
  const allRows = useMemo(() => timesheet?.rows ?? [], [timesheet]);
  // Precomputed id → index map. Avoids O(n²) indexOf in the row map below.
  const rowIndexById = useMemo(() => {
    const m = new Map<string, number>();
    allRows.forEach((r, i) => m.set(r.id, i));
    return m;
  }, [allRows]);

  useEffect(() => {
    tkPerf("picker useEffect entered", { pickerKind, pickerKey });
    if (pickerKind === "none") { setTimesheet(null); return; }

    if (pickerKind === "job") {
      const jobId = pickerKey;
      const jr = jobRequests.find((j) => j.id === jobId);
      if (!jr) return;
      // Remember the user's last-picked job for next visit
      setActiveJob(jobId);

      const linked = getTimesheetByJobId(jobId);
      tkPerf("getTimesheetByJobId returned", {
        found: !!linked,
        rowCount: linked?.rows?.length ?? 0,
      });
      if (linked) {
        setTimesheet(linked);
        tkPerf("setTimesheet(linked) called");
      } else {
        // Lazily create a timesheet in the DB so staff approval has somewhere
        // to land. The DB call de-dupes if a row already exists.
        const title = `${jr.jobNo ? jr.jobNo + " — " : ""}${jr.eventName || "Job"}`;
        ensureTimesheetForJobRequest(jobId, { jobTitle: title }).then((id) => {
          setTimesheet({
            id, jobId, jobSheetId: "", title,
            hideBillColumns: false, rows: [],
          });
        }).catch((e) => console.error("[timekeeping] ensure failed:", e));
      }
    } else if (pickerKind === "legacy") {
      const jobSheetId = pickerKey;
      const linked = getTimesheetByJobSheetId(jobSheetId);
      const sheet = sheets.find((s) => s.id === jobSheetId);
      if (linked) {
        setTimesheet(linked);
      } else if (sheet) {
        setTimesheet({
          id: `timesheet-${sheet.id}`,
          jobSheetId: sheet.id,
          jobId: null,
          title: sheet.title,
          hideBillColumns: false,
          rows: [],
        });
      }
    }
    setDayFilter("all");
    tkPerf("picker useEffect leaving (scheduled isSwitchingJob clear)");
    // Allow the overlay to clear once the new timesheet has been swapped in.
    // Wrapped in RAF so the spinner stays through the heavy render commit.
    requestAnimationFrame(() => {
      tkPerf("RAF → setIsSwitchingJob(false)");
      setIsSwitchingJob(false);
    });
  }, [picker, refreshKey]);

  // Group rows by workDate (with a "no-date" bucket for blank ones), days
  // sorted ascending. The editing UI renders one collapsible card per day.
  const dayGroups = useMemo(() => {
    const map = new Map<string, typeof allRows>();
    for (const r of allRows) {
      const k = r.workDate || "no-date";
      const list = map.get(k) ?? [];
      list.push(r);
      map.set(k, list);
    }
    return Array.from(map.entries()).sort(([a], [b]) => {
      if (a === "no-date") return 1;
      if (b === "no-date") return -1;
      return a.localeCompare(b);
    });
  }, [allRows]);

  // Effective collapsed state for a given day:
  //   1. If the user explicitly toggled it → honor that override.
  //   2. Otherwise apply the default: multi-day → collapsed, single-day → expanded.
  function isDayCollapsed(day: string): boolean {
    const explicit = collapsedOverrides.get(day);
    if (explicit !== undefined) return explicit;
    return dayGroups.length > 1;
  }
  // When the user expands a day with many rows, the actual collapse-toggle
  // state change triggers a heavy React render (each row tbody mounts its
  // own selects + autofill). The browser doesn't paint between the click
  // and that heavy render, so the operator just sees nothing happen for
  // a second or two. Defer the toggle behind two RAFs so the loading
  // overlay paints first, exactly the same trick we use on job-switch.
  const [expandingDayKey, setExpandingDayKey] = useState<string | null>(null);
  function setDayCollapsed(day: string, collapsed: boolean) {
    setCollapsedOverrides((prev) => {
      const next = new Map(prev);
      next.set(day, collapsed);
      return next;
    });
  }
  function toggleDay(day: string) {
    const explicit = collapsedOverrides.get(day);
    const cur = explicit !== undefined ? explicit : dayGroups.length > 1;
    if (cur) {
      // collapsed → expanded: show the spinner, then expand after a paint.
      setExpandingDayKey(day);
      requestAnimationFrame(() => requestAnimationFrame(() => {
        setDayCollapsed(day, false);
      }));
    } else {
      // expanded → collapsed: cheap, do it immediately.
      setDayCollapsed(day, true);
    }
  }
  // Clear the expanding flag once the expand commit has happened (one frame
  // after the override flipped to false). Keeps the spinner up through the
  // entire heavy render, then hides it.
  useEffect(() => {
    if (expandingDayKey === null) return;
    // "__all__" sentinel = expand all. Done when every day's override is false.
    const done = expandingDayKey === "__all__"
      ? dayGroups.length > 0 && dayGroups.every(([d]) => collapsedOverrides.get(d) === false)
      : !isDayCollapsed(expandingDayKey);
    if (!done) return;
    const id = requestAnimationFrame(() => setExpandingDayKey(null));
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expandingDayKey, collapsedOverrides, dayGroups]);

  function expandAll() {
    // Defer the same way — expanding all days at once is the heaviest
    // possible render, so we definitely want the spinner first.
    setExpandingDayKey("__all__");
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const m = new Map<string, boolean>();
      for (const [d] of dayGroups) m.set(d, false);
      setCollapsedOverrides(m);
    }));
  }
  function collapseAll() {
    const m = new Map<string, boolean>();
    for (const [d] of dayGroups) m.set(d, true);
    setCollapsedOverrides(m);
  }

  useEffect(() => {
    if (pickerKind === "job") {
      getPendingStaffEntriesByJobId(pickerKey).then(setPendingEntries);
    } else if (pickerKind === "legacy") {
      // Legacy job_sheets: staff entries still keyed on job_sheet_id today.
      // Phase 2 retires this branch entirely.
      import("@/lib/store/app-store").then(({ getPendingStaffEntries }) =>
        getPendingStaffEntries(pickerKey).then(setPendingEntries)
      );
    } else {
      setPendingEntries([]);
    }
  }, [picker, refreshKey]);

  // The selected job_request (canonical) — drives header display in "job" mode.
  const currentJob: JobRequest | null = useMemo(
    () => (pickerKind === "job" ? jobRequests.find((j) => j.id === pickerKey) || null : null),
    [picker, jobRequests],
  );
  // The job_sheet for legacy mode (and an auxiliary lookup for "Add Crew from
  // Job Sheet" when a canonical job happens to also have a matching sheet).
  const currentSheet: JobSheet | null = useMemo(() => {
    if (pickerKind === "legacy") return sheets.find((s) => s.id === pickerKey) || null;
    if (pickerKind === "job" && timesheet?.jobSheetId) {
      return sheets.find((s) => s.id === timesheet.jobSheetId) || null;
    }
    return null;
  }, [picker, sheets, timesheet?.jobSheetId]);
  const headerTitle = currentJob
    ? `${currentJob.jobNo ? currentJob.jobNo + " — " : ""}${currentJob.eventName || ""} — ${currentJob.client || ""}`.replace(/ — $/, "")
    : (currentSheet?.title || "No job selected");
  const headerClient = currentJob?.client || currentSheet?.client || "";
  const summary = useMemo(() => summarizeTimesheet(timesheet), [timesheet]);
  const approvedSummary = useMemo(
    () => summarizeTimesheet(timesheet, (r) => r.status === "approved"),
    [timesheet]
  );

  function persist(next: Timesheet) {
    setTimesheet(next);
    upsertTimesheet(next);
    // NOTE: do NOT setRefreshKey here — that would trigger a useEffect that
    // reloads the timesheet from cache, potentially racing with the state update.
    // refreshKey is only incremented by explicit user actions (job sheet change).
  }

  function updateRow(id: string, patch: Partial<TimeEntry>) {
    if (!timesheet) return;
    const nextRows = timesheet.rows.map((r) => r.id === id ? computeTimeEntry({ ...r, ...patch }) : r);
    persist({ ...timesheet, rows: nextRows });
  }

  // True while the "+ Add Crew Member" modal is open. We use a modal-first
  // flow so the operator MUST pick an employee before the row exists —
  // otherwise we end up with blank rows (the Carolina cleanup found 20 of
  // these on a single job, all needing manual deletion later).
  const [addCrewModalOpen, setAddCrewModalOpen] = useState(false);
  function addRowForEmployee(emp: PickerEmployee) {
    if (!timesheet) return;
    const stamp = Date.now();
    const base = blankTimeEntry(`manual-${stamp}`);
    persist({
      ...timesheet,
      rows: [...timesheet.rows, {
        ...base,
        employeeKey: emp.employeeKey,
        firstName: emp.firstName || emp.fullName.split(" ")[0] || "",
        lastName:  emp.lastName  || emp.fullName.split(" ").slice(1).join(" ") || "",
        phone: emp.phone || "",
        email: emp.email || "",
        status: "submitted",
      }],
    });
  }

  // Legacy path — pulls a flat worker list off the linked job_sheet.
  // Phase 2 retires this for canonical jobs (which have per-day assignments);
  // kept available for the 3 stragglers whose job_id couldn't be backfilled.
  function addWorkersFromJobSheet() {
    if (!timesheet || !currentSheet) return;
    const existingEmails = new Set(timesheet.rows.map((r) => r.email));
    const nextRows = [...timesheet.rows];
    currentSheet.workers.forEach((w, idx) => {
      if (existingEmails.has(w.email)) return;
      const parts = splitName(w.fullName);
      nextRows.push(computeTimeEntry({
        ...blankTimeEntry(`worker-${Date.now()}-${idx}`),
        position: w.role || "Stagehand",
        firstName: parts.firstName,
        lastName: parts.lastName,
        phone: w.phone || "",
        email: w.email || "",
        employeeKey: w.employeeKey || null,
        status: "submitted",
      }));
    });
    persist({ ...timesheet, rows: nextRows });
  }

  // Phase 2 canonical path — seeds one TimeEntry per per-day crew assignment
  // on the selected job_request. Each row carries the right workDate, shiftId,
  // and (Phase 3) positionId/specialtyId/employeeKey from the assignment.
  // Dedupes against existing rows by (employee_key, work_date, shift_id) so
  // re-running the button doesn't double-add.
  const [addingCrew, setAddingCrew] = useState(false);
  // Phase 2: shift label lookup for the selected job, so per-row chips can
  // show which shift each entry belongs to. Loaded once per job switch.
  const [shiftLabelById, setShiftLabelById] = useState<Map<string, string>>(new Map());
  /** True when the current job has at least one shift defined. The approve
   *  gate uses this to require shift_id on every row — payroll's daily
   *  rules group by shift, so a missing shift breaks the 5hr-min calc on
   *  multi-shift days. */
  const jobHasShifts = shiftLabelById.size > 0;
  // Phase 4: per-date holiday lookup for the selected job. Maps YYYY-MM-DD
  // to {isHoliday: true} for days the planner flagged. Drives auto-seeding
  // of isHoliday on new rows + the day-group "🎄 Holiday" badge.
  const [holidayDateSet, setHolidayDateSet] = useState<Set<string>>(new Set());
  const [jobHolidayMultiplier, setJobHolidayMultiplier] = useState<number | null>(null);
  // Live bill rates per specialty for THIS job — resolved by following the
  // job's most recent quote to its rate_card_profile_id, then loading the
  // rate-card rows. The timekeeping grid displays these read-only so the
  // operator sees the rate that will actually be billed when the invoice
  // pulls labor actuals (see lib/store/invoices.ts:686 — bill rates come
  // from the rate card keyed by specialty_id, NOT from the timesheet row).
  type RateCardRate = {
    hourly: number;
    otRate: number;
    dtRate: number;
    /** Threshold in hours. 0 = no bucket, NULL = use legacy default. */
    otAfter: number | null;
    dtAfter: number | null;
  };
  const [rateCardBySpecialty, setRateCardBySpecialty] = useState<Map<string, RateCardRate>>(new Map());
  useEffect(() => {
    if (pickerKind !== "job") {
      setShiftLabelById(new Map());
      setHolidayDateSet(new Set());
      setJobHolidayMultiplier(null);
      setRateCardBySpecialty(new Map());
      return;
    }
    tkPerf("job-meta useEffect entered (3 parallel queries)");
    import("@/lib/supabase/client").then(({ supabase }) => {
      tkPerf("supabase client imported");
      // Shifts
      supabase.from("job_request_shifts").select("id, label").eq("job_request_id", pickerKey)
        .then(({ data, error }) => {
          if (error) { console.error("[timekeeping] load shifts:", error); return; }
          const m = new Map<string, string>();
          for (const r of (data ?? []) as any[]) m.set(r.id, r.label ?? "");
          tkPerf("shifts query resolved → setShiftLabelById", { count: m.size });
          setShiftLabelById(m);
        });
      // Holiday days
      supabase.from("job_request_days").select("event_date, is_holiday").eq("job_request_id", pickerKey).eq("is_holiday", true)
        .then(({ data, error }) => {
          if (error) { console.error("[timekeeping] load holiday days:", error); return; }
          const s = new Set<string>();
          for (const r of (data ?? []) as any[]) if (r.event_date) s.add(String(r.event_date));
          tkPerf("holiday-days query resolved → setHolidayDateSet", { count: s.size });
          setHolidayDateSet(s);
        });
      // Resolve the multiplier + rate card profile via the job's most recent
      // quote (the V2 snapshot pattern locks the rate card to the quote, so
      // this is the source of truth for what will be billed).
      supabase.from("quotes")
        .select("holiday_multiplier, rate_card_profile_id")
        .eq("job_request_id", pickerKey)
        .order("created_at", { ascending: false })
        .limit(1)
        .then(({ data, error }) => {
          if (error) { console.error("[timekeeping] load quote:", error); return; }
          const q = data?.[0] as any;
          const v = q?.holiday_multiplier;
          tkPerf("multiplier query resolved → setJobHolidayMultiplier", { value: v });
          setJobHolidayMultiplier(v == null ? null : Number(v));
          const rcId = q?.rate_card_profile_id;
          if (!rcId) {
            tkPerf("no rate_card_profile_id on quote", {});
            setRateCardBySpecialty(new Map());
            return;
          }
          // Pull the rate-card rows for this snapshot, build a per-specialty
          // map for the row render to look up.
          supabase.from("rate_card_profile_rows")
            .select("specialty_id, hourly, ot_rate, dt_rate, ot_after, dt_after")
            .eq("profile_id", rcId)
            .then(({ data: rows, error: rowsErr }) => {
              if (rowsErr) { console.error("[timekeeping] load rate card rows:", rowsErr); return; }
              const m = new Map<string, RateCardRate>();
              for (const r of (rows ?? []) as any[]) {
                if (!r.specialty_id) continue;
                m.set(r.specialty_id, {
                  hourly: Number(r.hourly ?? 0),
                  otRate: Number(r.ot_rate ?? 0),
                  dtRate: Number(r.dt_rate ?? 0),
                  // Map TriggerOption text → int snapshot. "none"/""/"weekly40"
                  // → 0 (no bucket); numeric strings parse as the threshold;
                  // anything else → null = fall back to legacy default.
                  otAfter: triggerToInt(r.ot_after),
                  dtAfter: triggerToInt(r.dt_after),
                });
              }
              tkPerf("rate card rows resolved → setRateCardBySpecialty", { count: m.size });
              setRateCardBySpecialty(m);
            });
        });
    });
  }, [picker]);
  const effectiveHolidayMultiplier = jobHolidayMultiplier ?? 2.0;
  async function addCrewFromJob() {
    if (!timesheet || pickerKind !== "job") return;
    setAddingCrew(true);
    try {
      const slots = await loadJobCrewSlots(pickerKey);
      if (slots.length === 0) {
        alert("This job has no per-day crew assignments yet. Add them on the Job Request → Assigned Crew tab first.");
        return;
      }
      // Dedupe key — same employee on same day + same shift counts as one row.
      const seen = new Set(timesheet.rows.map((r) =>
        `${r.employeeKey || ""}|${r.workDate || ""}|${r.shiftId || ""}`
      ));
      const positions = loadPositions();
      const employees = loadEmployees();
      const nextRows = [...timesheet.rows];
      slots.forEach((slot, idx) => {
        const key = `${slot.employeeKey || ""}|${slot.eventDate}|${slot.shiftId || ""}`;
        if (seen.has(key)) return;
        const emp = slot.employeeKey ? employees.find((e) => e.employeeKey === slot.employeeKey) : null;
        const posName = positions.find((p) => p.id === slot.positionId)?.name || "Stagehand";
        const isHol = holidayDateSet.has(slot.eventDate);
        // Snapshot bill rates + OT/DT thresholds from rate card (migration
        // 20260606a). Specialty-keyed lookup; falls back to blankTimeEntry
        // defaults when missing. Thresholds left null fall through to the
        // legacy 8/12 default in computeTimeEntry.
        const rc = slot.specialtyId ? rateCardBySpecialty.get(slot.specialtyId) : undefined;
        nextRows.push(computeTimeEntry({
          ...blankTimeEntry(`crew-${Date.now()}-${idx}`),
          position: posName,
          positionId: slot.positionId,
          specialtyId: slot.specialtyId,
          firstName: emp?.firstName || emp?.fullName?.split(" ")?.[0] || "",
          lastName:  emp?.lastName  || emp?.fullName?.split(" ")?.slice(1).join(" ") || "",
          phone: emp?.phone || "",
          email: emp?.email || "",
          employeeKey: slot.employeeKey || null,
          workDate: slot.eventDate || undefined,
          endDate:  slot.eventDate || undefined,
          timeIn1:  slot.startTime || "",
          timeOut1: slot.endTime || "",
          shiftId: slot.shiftId,
          isHoliday: isHol,
          holidayMultiplier: isHol ? effectiveHolidayMultiplier : null,
          status: "submitted",
          ...(rc ? {
            billStdRate: rc.hourly,
            billOtRate:  rc.otRate,
            billDtRate:  rc.dtRate,
            billOtAfter: rc.otAfter,
            billDtAfter: rc.dtAfter,
          } : {}),
        }));
        seen.add(key);
      });
      if (nextRows.length === timesheet.rows.length) {
        alert(`All ${slots.length} crew assignments are already on this timesheet.`);
        return;
      }
      persist({ ...timesheet, rows: nextRows });
    } catch (e) {
      console.error("[timekeeping] addCrewFromJob failed:", e);
      alert("Couldn't load crew assignments — see console for details.");
    } finally {
      setAddingCrew(false);
    }
  }

  // Copy every entry from the previous day-group into the given day. New rows
  // get fresh ids, workDate/endDate retargeted to the current day, status
  // reset to 'submitted', invoice binding cleared, and holiday flags
  // recomputed from the target day's holiday status. Matches the pattern on
  // job-request crew assignments (the "Copy ↑" button there).
  function duplicateDay(sourceDay: string, targetDay: string) {
    if (!timesheet) return;
    const sourceRows = timesheet.rows.filter((r) => (r.workDate || "no-date") === sourceDay);
    if (sourceRows.length === 0) {
      alert(`${sourceDay} has no entries to copy.`);
      return;
    }
    if (!confirm(`Copy ${sourceRows.length} entr${sourceRows.length === 1 ? "y" : "ies"} from ${sourceDay} to ${targetDay}?`)) return;
    const isHol = targetDay !== "no-date" && holidayDateSet.has(targetDay);
    const stamp = Date.now();
    const copies = sourceRows.map((r, i) => computeTimeEntry({
      ...r,
      id: `dup-${stamp}-${i}`,
      workDate: targetDay === "no-date" ? undefined : targetDay,
      endDate:  targetDay === "no-date" ? undefined : targetDay,
      isHoliday: isHol,
      holidayMultiplier: isHol ? effectiveHolidayMultiplier : null,
      status: "submitted",
      invoiceLineId: null,
    }));
    persist({ ...timesheet, rows: [...timesheet.rows, ...copies] });
    // Force-expand the target day so the operator sees the freshly-copied
    // rows immediately.
    if (isDayCollapsed(targetDay)) {
      setCollapsedOverrides((prev) => {
        const next = new Map(prev);
        next.set(targetDay, false);
        return next;
      });
    }
  }

  // Spawn a brand-new day by cloning this day's entries onto a date the
  // operator picks. Defaults the prompt to the day after `sourceDay`.
  function copyDayToNewDate(sourceDay: string) {
    if (sourceDay === "no-date") return;
    const defaultNext = (() => {
      const d = new Date(sourceDay + "T00:00:00");
      d.setDate(d.getDate() + 1);
      return d.toISOString().slice(0, 10);
    })();
    const input = prompt(`Copy this day's entries to which date? (YYYY-MM-DD)`, defaultNext);
    if (!input) return;
    const target = input.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(target)) {
      alert("Please enter a date in YYYY-MM-DD format.");
      return;
    }
    if (target === sourceDay) {
      alert("Target date is the same as the source day.");
      return;
    }
    duplicateDay(sourceDay, target);
  }

  // Opens the picker modal — the row is created in addRowForEmployee()
  // only after the operator commits a choice. This replaces the legacy
  // "+ Add Blank Row" path that created rows with no employee linked.
  function addManualCrew() {
    if (!timesheet) return;
    setAddCrewModalOpen(true);
  }

  function removeRow(id: string) {
    if (!timesheet) return;
    // Confirm — the entry is removed from the timesheet and persisted away on
    // the next save. If the entry has already been billed onto an invoice
    // line, the invoice_line_id pointer will go stale and the entry will
    // re-appear available on a future "Overwrite from Timesheets" run.
    if (!confirm("Delete this timesheet row? This removes the entry from the timesheet on save.")) return;
    persist({ ...timesheet, rows: timesheet.rows.filter((r) => r.id !== id) });
  }

  async function handleApprove(entry: import("@/lib/store/types").TimeEntry) {
    if (!timesheet) return;
    // Block approval if specialty isn't picked — payroll resolves pay rates
    // by (job, specialty), so an approved row without specialty_id will get
    // $0 pay rates and require operator override. Cheaper to fix here.
    // Skip the check for positions that have NO specialties in the master
    // (e.g. office-only roles where there's nothing to pick).
    if (requiresSpecialty(entry.positionId) && !entry.specialtyId) {
      alert(
        "Specialty is required to approve this entry.\n\n" +
        "Pick the specific role (e.g. Climber vs Up Rigger) from the Specialty " +
        "dropdown — payroll uses it to look up the pay rate."
      );
      return;
    }
    // Block approval if the job has shifts defined and this row has no
    // shift_id. Payroll's daily rules group by shift — a missing shift
    // means an unbumped 5hr-min day or wrong grouping.
    if (jobHasShifts && !entry.shiftId) {
      alert(
        "Shift is required to approve this entry.\n\n" +
        "Pick the shift (Load In, Steel, Production Load Out, etc.) from the " +
        "Shift dropdown — payroll groups daily rules by shift."
      );
      return;
    }
    await approveStaffEntry(entry.id, timesheet.id);
    setPendingEntries((prev) => prev.filter((e) => e.id !== entry.id));
    // Also add to in-memory timesheet so it appears in the grid immediately
    persist({ ...timesheet, rows: [...timesheet.rows, { ...entry, status: "approved" }] });
  }

  async function handleReject(entryId: string) {
    // Used by the "Staff Submissions Pending Review" panel below the grid
    // (separate from the bulk-select flow on the grid itself).
    await rejectStaffEntry(entryId);
    setPendingEntries((prev) => prev.filter((e) => e.id !== entryId));
  }

  // ─── Bulk row actions (admin only) ─────────────────────────────────────────
  // All three operate on the in-memory timesheet rows whose id is in
  // selectedIds. Approve/Reject mirror the single-row handlers; Delete is
  // a single in-memory filter call followed by persist.
  function toggleRowSelected(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function toggleAllRowsSelected() {
    if (!timesheet) return;
    const all = new Set(timesheet.rows.map((r) => r.id));
    const allSelected = timesheet.rows.length > 0 && timesheet.rows.every((r) => selectedIds.has(r.id));
    setSelectedIds(allSelected ? new Set() : all);
  }
  async function handleApproveSelected() {
    if (!timesheet) return;
    const eligible = timesheet.rows.filter((r) => selectedIds.has(r.id) && r.status !== "approved" && r.employeeKey);
    if (eligible.length === 0) return;
    // Block approval when specialty_id is missing — but only for positions
    // that actually have specialties defined in the master. Positions with
    // no specialty choices pass through. Also block when shift_id is missing
    // if the job has shifts defined.
    const missingSpec  = eligible.filter((r) => requiresSpecialty(r.positionId) && !r.specialtyId);
    const missingShift = eligible.filter((r) => jobHasShifts && !r.shiftId);
    const targets      = eligible.filter((r) =>
      !(requiresSpecialty(r.positionId) && !r.specialtyId)
      && !(jobHasShifts && !r.shiftId)
    );
    if (missingSpec.length > 0 || missingShift.length > 0) {
      const reasons: string[] = [];
      if (missingSpec.length > 0) {
        const list = missingSpec.slice(0, 5)
          .map((r) => `  • ${r.firstName ?? ""} ${r.lastName ?? ""} ${r.workDate ?? ""} (${r.position ?? "?"})`)
          .join("\n");
        const more = missingSpec.length > 5 ? `\n  …and ${missingSpec.length - 5} more` : "";
        reasons.push(
          `${missingSpec.length} entr${missingSpec.length === 1 ? "y is" : "ies are"} missing a Specialty:\n${list}${more}`
        );
      }
      if (missingShift.length > 0) {
        const list = missingShift.slice(0, 5)
          .map((r) => `  • ${r.firstName ?? ""} ${r.lastName ?? ""} ${r.workDate ?? ""} (${r.position ?? "?"})`)
          .join("\n");
        const more = missingShift.length > 5 ? `\n  …and ${missingShift.length - 5} more` : "";
        reasons.push(
          `${missingShift.length} entr${missingShift.length === 1 ? "y is" : "ies are"} missing a Shift:\n${list}${more}`
        );
      }
      const msg =
        `These entries won't be approved:\n\n${reasons.join("\n\n")}\n\n` +
        (targets.length > 0
          ? `Approve the remaining ${targets.length} entr${targets.length === 1 ? "y" : "ies"}?`
          : `Fill in the missing fields first, then approve.`);
      if (targets.length === 0) { alert(msg); return; }
      if (!confirm(msg)) return;
    }
    if (targets.length === 0) return;
    setBusyBatch("approve");
    try {
      for (const r of targets) {
        try { await setEntryApproved(r.id); }
        catch (e) { console.error("[timekeeping] batch approve row failed:", r.id, e); }
      }
      const ids = new Set(targets.map((r) => r.id));
      persist({ ...timesheet, rows: timesheet.rows.map((r) => ids.has(r.id) ? { ...r, status: "approved" } : r) });
      setSelectedIds(new Set());
    } finally { setBusyBatch(null); }
  }
  async function handleRejectSelected() {
    if (!timesheet) return;
    // Approved-AND-invoice-bound rows can't be re-rejected (DB trigger blocks
    // the status change). Filter them out and warn if any were skipped.
    const eligible = timesheet.rows.filter((r) => selectedIds.has(r.id) && r.status !== "rejected" && r.employeeKey);
    const lockedByInvoice = eligible.filter((r) => r.status === "approved" && r.invoiceLineId);
    const targets = eligible.filter((r) => !(r.status === "approved" && r.invoiceLineId));
    if (targets.length === 0) return;
    const lockedNote = lockedByInvoice.length > 0
      ? `\n\n${lockedByInvoice.length} invoice-bound entr${lockedByInvoice.length === 1 ? "y will" : "ies will"} be skipped (unlink from invoice first).`
      : "";
    if (!confirm(`Reject ${targets.length} timesheet ${targets.length === 1 ? "entry" : "entries"}?${lockedNote}`)) return;
    setBusyBatch("reject");
    try {
      for (const r of targets) {
        try { await rejectStaffEntry(r.id); }
        catch (e) { console.error("[timekeeping] batch reject row failed:", r.id, e); }
      }
      const ids = new Set(targets.map((r) => r.id));
      persist({ ...timesheet, rows: timesheet.rows.map((r) => ids.has(r.id) ? { ...r, status: "rejected" } : r) });
      setSelectedIds(new Set());
    } finally { setBusyBatch(null); }
  }
  // Unlock approved rows back to 'submitted' so they can be edited. DB trigger
  // permits this transition. Invoice-bound rows are excluded (super-frozen) —
  // operator must unlink via the invoice draft editor first.
  async function handleUnlockSelected() {
    if (!timesheet) return;
    const targets = timesheet.rows.filter((r) =>
      selectedIds.has(r.id)
      && r.status === "approved"
      && !r.invoiceLineId
    );
    if (targets.length === 0) return;
    if (!confirm(`Unlock ${targets.length} approved ${targets.length === 1 ? "entry" : "entries"} for edit? Each will move back to 'submitted' — the prior approval is lost.`)) return;
    setBusyBatch("approve"); // reuse spinner state visually
    try {
      for (const r of targets) {
        try { await setEntrySubmitted(r.id); }
        catch (e) { console.error("[timekeeping] batch unlock row failed:", r.id, e); }
      }
      const ids = new Set(targets.map((r) => r.id));
      persist({ ...timesheet, rows: timesheet.rows.map((r) => ids.has(r.id) ? { ...r, status: "submitted" } : r) });
      setSelectedIds(new Set());
    } finally { setBusyBatch(null); }
  }
  // Per-action eligibility counts for the batch buttons. Each button label
  // shows the actionable count (not the raw selection count) so the operator
  // sees the truth about what a click will do. Buttons disable at 0.
  //   approve: rows not already approved (and have an employee)
  //   reject:  rows not already rejected and NOT super-frozen by invoice binding
  //   unlock:  approved rows that aren't invoice-bound
  //   delete:  rows not approved (DB freeze blocks delete on approved)
  const eligible = useMemo(() => {
    if (!timesheet) return { approve: 0, reject: 0, unlock: 0, delete: 0 };
    const sel = timesheet.rows.filter((r) => selectedIds.has(r.id));
    return {
      approve: sel.filter((r) => r.status !== "approved" && r.employeeKey).length,
      reject:  sel.filter((r) => r.status !== "rejected" && r.employeeKey && !(r.status === "approved" && r.invoiceLineId)).length,
      unlock:  sel.filter((r) => r.status === "approved" && !r.invoiceLineId).length,
      delete:  sel.filter((r) => r.status !== "approved").length,
    };
  }, [timesheet, selectedIds]);
  function handleDeleteSelected() {
    if (!timesheet) return;
    const count = selectedIds.size;
    if (count === 0) return;
    // Approved rows are DB-frozen against DELETE; skip them and warn.
    const approvedCount = timesheet.rows.filter((r) => selectedIds.has(r.id) && r.status === "approved").length;
    const deletable = timesheet.rows.filter((r) => selectedIds.has(r.id) && r.status !== "approved");
    if (deletable.length === 0) {
      alert(`All ${count} selected ${count === 1 ? "entry is" : "entries are"} approved and cannot be deleted. Unlock them first.`);
      return;
    }
    const skippedNote = approvedCount > 0
      ? `\n\n${approvedCount} approved entr${approvedCount === 1 ? "y" : "ies"} will be skipped (unlock first to delete).`
      : "";
    if (!confirm(`Delete ${deletable.length} timesheet row${deletable.length === 1 ? "" : "s"}? This removes them from the timesheet on save.${skippedNote}`)) return;
    const ids = new Set(deletable.map((r) => r.id));
    persist({ ...timesheet, rows: timesheet.rows.filter((r) => !ids.has(r.id)) });
    setSelectedIds(new Set());
  }

  const totals = useMemo(() => {
    const rows = timesheet?.rows || [];
    return rows.reduce((acc, r) => {
      acc.stdHours += r.stdHours; acc.otHours += r.otHours; acc.dtHours += r.dtHours;
      acc.totalHours += r.totalHours; acc.billTotal += r.billTotal;
      return acc;
    }, { stdHours:0, otHours:0, dtHours:0, totalHours:0, billTotal:0 });
  }, [timesheet]);

  // Unique dates touched by any row (workDate + endDate covers cross-midnight
   // shifts), oldest first. Used by the day filter.
  const availableDays = useMemo(() => {
    const set = new Set<string>();
    for (const r of timesheet?.rows ?? []) {
      if (r.workDate) set.add(r.workDate);
      if (r.endDate)  set.add(r.endDate);
    }
    return Array.from(set).sort();
  }, [timesheet]);

  // (allRows is declared earlier — used by both day grouping and the table render.)

  if (TK_PERF_ON) {
    tkPerf("render() — building VDOM", {
      rowCount: allRows.length,
      dayGroupCount: dayGroups.length,
      hasTimesheet: !!timesheet,
      isSwitchingJob,
      shiftLabelCount: shiftLabelById.size,
      holidayDayCount: holidayDateSet.size,
      multiplier: jobHolidayMultiplier,
    });
  }
  // After commit, log how long the browser took to actually paint after this
  // render. Combined with the render() event above, the gap = commit + paint.
  useEffect(() => {
    tkPerf("post-commit (browser painted)");
  });

  // Show a music-themed overlay while the timesheet for the selected job is
  // being fetched (ensureTimesheetForJobRequest can take a beat on cold load)
  // and during any long-running batch action.
  const isLoadingTimesheet = pickerKind !== "none" && timesheet === null;
  const isExpanding = expandingDayKey !== null;
  const isBusy = isLoadingTimesheet || isSwitchingJob || isExpanding || addingCrew || busyBatch !== null;
  const busyLabel = (isLoadingTimesheet || isSwitchingJob)
    ? "Loading the set list…"
    : isExpanding
      ? (expandingDayKey === "__all__"
          ? "Bringing the whole crew on stage…"
          : "Bringing the crew on stage…")
      : addingCrew
      ? "Calling the crew to the stage…"
      : busyBatch === "approve"
        ? "Cueing approvals…"
        : busyBatch === "reject"
          ? "Sending rejections backstage…"
          : busyBatch === "delete"
            ? "Striking the set…"
            : "Working…";

  return (
    <div className="grid" style={{ position: "relative" }}>
      {isBusy && <EqualizerLoader label={busyLabel} />}
      <div className="card hide-print">
        <h2 className="section-title" style={{ display: "flex", alignItems: "center", gap: 12 }}>
          Timekeeping Control Center
          {TK_PERF_ON && (
            <button
              type="button"
              onClick={() => tkPerfDownload()}
              title="Download the dev-only perf trace as JSON (Save As dialog)"
              style={{
                fontSize: 11, padding: "2px 8px",
                background: "#fff7e0", color: "#7a5a1a",
                border: "1px solid #e0c070", borderRadius: 6, cursor: "pointer",
                fontWeight: 600,
              }}
            >📥 perf log</button>
          )}
        </h2>
        <div className="grid4">
          <div>
            <small>Job</small>
            <select value={picker} onChange={(e) => changePicker(e.target.value as PickerValue)}>
              <option value="">Select a job</option>
              <optgroup label="Jobs">
                {jobRequests
                  .slice()
                  .filter((j) => j.status !== "cancelled")
                  .sort((a, b) => (b.requestDate || "").localeCompare(a.requestDate || ""))
                  .map((j) => (
                    <option key={j.id} value={`job:${j.id}`}>
                      {j.jobNo || j.eventName || "(untitled)"}
                    </option>
                  ))}
              </optgroup>
              {timesheets.some((t) => !t.jobId) && (
                <optgroup label="Legacy (no Job linked)">
                  {timesheets
                    .filter((t) => !t.jobId && t.jobSheetId)
                    .map((t) => {
                      const sheet = sheets.find((s) => s.id === t.jobSheetId);
                      const label = sheet
                        ? `${sheet.client || ""} — ${sheet.eventName || sheet.title || ""} — ${sheet.date || ""}`
                        : t.title;
                      return (
                        <option key={t.id} value={`legacy:${t.jobSheetId}`}>{label}</option>
                      );
                    })}
                </optgroup>
              )}
            </select>
          </div>
          {!hideBillAlways && (
            <div className="list-card">
              <strong>Linked Invoice / Quote Detail</strong>
              <div className="muted">Use this page to generate time-based labor breakdowns that feed quote and invoice detail.</div>
            </div>
          )}
          {!hideBillAlways && (
            <div className="list-card">
              <strong>Hide Bill Columns</strong>
              <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                Hides STD BILL / OT BILL / DT BILL / TOTAL BILL when sharing
                this view with someone who shouldn't see billing data.
              </div>
              <div className="action-row" style={{ marginTop: 8 }}>
                <button
                  className="secondary"
                  onClick={() => timesheet && persist({
                    ...timesheet,
                    hideBillColumns: !hideBillAlways && !timesheet.hideBillColumns,
                  })}
                >
                  {timesheet?.hideBillColumns ? "Show Bill Columns" : "Hide Bill Columns"}
                </button>
              </div>
            </div>
          )}
          <div style={{
            border: "1px solid var(--line, #d7c6aa)",
            borderRadius: 12,
            padding: "10px 14px",
            background: "var(--cream, #fbf6ee)",
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}>
            <strong style={{ fontSize: 12, opacity: 0.75 }}>📄 Print / Export</strong>
            {availableDays.length > 0 && (
              <div>
                <small>Print which day?</small>
                <select value={dayFilter} onChange={(e) => setDayFilter(e.target.value)}>
                  <option value="all">All days{availableDays.length > 1 ? ` (${availableDays.length})` : ""}</option>
                  {availableDays.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
            )}
            <button onClick={() => {
              // Expand all days first so collapsed-day rows are in the DOM
              // (we conditionally skip rendering them when collapsed for perf).
              // Then wait through two RAFs + a settle delay so React has fully
              // committed the row mount before window.print() fires — the
              // previous 50ms timeout was too short on big jobs (Carolina has
              // 525 rows) and Chrome would error with "Print preview failed".
              const prevOverrides = new Map(collapsedOverrides);
              const expanded = new Map<string, boolean>();
              for (const [d] of dayGroups) expanded.set(d, false);
              setExpandingDayKey("__all__");  // show overlay during prep
              setCollapsedOverrides(expanded);
              requestAnimationFrame(() => requestAnimationFrame(() => {
                // 2 RAFs guarantees React has committed; the 400ms settle
                // gives the browser time to lay out the new DOM nodes before
                // we hand the document over to the print engine.
                setTimeout(() => {
                  setExpandingDayKey(null);
                  printWithTitle([
                    "Timesheet",
                    headerTitle,
                    headerClient,
                    dayFilter !== "all" ? dayFilter : undefined,
                  ]);
                  setTimeout(() => setCollapsedOverrides(prevOverrides), 1000);
                }, 400);
              }));
            }}>Download / Print PDF</button>
          </div>
        </div>
        {pickerKind === "job" && !jobHasShifts && timesheet && (
          <div style={{
            marginTop: 12,
            padding: "8px 12px",
            background: "#fdf3d8",
            border: "1px solid #d8a800",
            borderRadius: 4,
            fontSize: 13,
          }}>
            <strong>⚠ No shifts defined on this job.</strong>
            <div className="muted" style={{ marginTop: 4, fontSize: 12 }}>
              The Shift dropdown is hidden because there's nothing to pick.
              Payroll's daily rules (5-hour minimum, round-up) will group by
              position instead of by shift. Multi-shift days
              (morning call + load-out) won't get separate 5-hour minimums.
              Open the job request and set up shifts on the <strong>Shifts</strong> tab
              before approving these timesheets.
            </div>
          </div>
        )}
        <div className="action-row" style={{ marginTop: 12 }}>
          {pickerKind === "job" ? (
            <button
              onClick={addCrewFromJob}
              disabled={!timesheet || addingCrew}
              title="Seed one row per scheduled assignment from the Job Request → Assigned Crew tab"
            >
              {addingCrew ? "Loading…" : "Add Crew from Job"}
            </button>
          ) : (
            <button
              onClick={addWorkersFromJobSheet}
              disabled={!currentSheet}
              title="Legacy: pulls workers from the linked job_sheet's flat crew list"
            >
              Add Crew from Job Sheet
            </button>
          )}
          <button className="secondary" onClick={addManualCrew} disabled={!timesheet}>+ Add Crew Member</button>
          {timesheet && timesheet.rows.length > 0 && (
            <>
              <span style={{ flex: 1 }} />
              <button className="secondary" onClick={expandAll} style={{ fontSize: 12, padding: "4px 10px" }}>Expand all</button>
              <button className="secondary" onClick={collapseAll} style={{ fontSize: 12, padding: "4px 10px" }}>Collapse all</button>
            </>
          )}
        </div>
        {/* Batch action bar — appears when one or more rows are ticked (admin only). */}
        {!hideBillAlways && selectedIds.size > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12, padding: "6px 12px",
                        background: "#eaf2fb", border: "1px solid #b6c8e0", borderRadius: 8, flexWrap: "wrap" }}>
            <strong style={{ fontSize: 13 }}>{selectedIds.size} selected</strong>
            <button
              onClick={handleApproveSelected}
              disabled={!!busyBatch || eligible.approve === 0}
              title={eligible.approve === 0 ? "No selected rows are eligible to approve" : `Approve ${eligible.approve} of ${selectedIds.size}`}
              style={{ padding: "4px 12px", fontSize: 12 }}
            >
              {busyBatch === "approve" ? "Approving…" : `Approve ${eligible.approve}`}
            </button>
            <button
              className="secondary"
              onClick={handleRejectSelected}
              disabled={!!busyBatch || eligible.reject === 0}
              title={eligible.reject === 0 ? "No selected rows are eligible to reject (invoice-bound rows can't be rejected — unlink the invoice line first)" : `Reject ${eligible.reject} of ${selectedIds.size}`}
              style={{ padding: "4px 12px", fontSize: 12, color: "#a00", borderColor: "#e0a0a0" }}
            >
              {busyBatch === "reject" ? "Rejecting…" : `Reject ${eligible.reject}`}
            </button>
            <button
              className="secondary"
              onClick={handleUnlockSelected}
              disabled={!!busyBatch || eligible.unlock === 0}
              title={eligible.unlock === 0 ? "No approved+unbound rows selected" : `Unlock ${eligible.unlock} approved entr${eligible.unlock === 1 ? "y" : "ies"} for editing`}
              style={{ padding: "4px 12px", fontSize: 12 }}
            >
              🔓 Unlock {eligible.unlock}
            </button>
            <button
              className="danger"
              onClick={handleDeleteSelected}
              disabled={!!busyBatch || eligible.delete === 0}
              title={eligible.delete === 0 ? "All selected rows are approved (locked). Unlock first to delete." : `Delete ${eligible.delete} of ${selectedIds.size}`}
              style={{ padding: "4px 12px", fontSize: 12 }}
            >
              {busyBatch === "delete" ? "Deleting…" : `Delete ${eligible.delete}`}
            </button>
            <button className="secondary" onClick={() => setSelectedIds(new Set())} disabled={!!busyBatch} style={{ padding: "4px 10px", fontSize: 12 }}>
              Clear
            </button>
          </div>
        )}
      </div>

      {dayFilter !== "all" && (
        <style>{`
          @media print {
            /* Hide every part of every OTHER day — rows, the day-separator
               banner, and the print-pagebreak marker. Without this, the
               markers still fire and produce blank pages of empty
               separators between the visible day's data. */
            .timesheet-grid tbody.line-employee[data-day]:not([data-day="${dayFilter}"]),
            .timesheet-grid tbody.day-separator[data-day]:not([data-day="${dayFilter}"]),
            .timesheet-grid tbody.print-pagebreak[data-day]:not([data-day="${dayFilter}"]) {
              display: none !important;
            }
          }
        `}</style>
      )}

      <div className="invoice-shell">
        <div className="timesheet-pdf-header">
          <div className="pdf-logo-wrap pdf-logo-wrap--small">
            <img src="/branding/client-logo.png" alt="Logo" className="pdf-logo pdf-logo--small" />
          </div>
          <div className="pdf-title-wrap pdf-title-wrap--left">
            <h2 className="pdf-title pdf-title--compact">Timekeeping Sheet</h2>
            <div className="pdf-subtitle pdf-subtitle--event">
              {headerTitle}
            </div>
          </div>
        </div>

        {!timesheet ? (
          <div className="muted">Select a job to begin timekeeping.</div>
        ) : (
          <>
            <div style={{ overflowX: "auto" }}>
              {(() => {
                const showBill = !hideBillAlways && !timesheet.hideBillColumns;
                // Row-1 layout: Position | Name | Start | End | (phantom for
                // hidden hour/rate cols). Each visible row-1 label spans exactly
                // 2 row-2 cells so the right edge of End Date aligns with the
                // right edge of Meal 2 in print (where hour cols are hidden).
                // Row 2 has 12 cells without pay (Sig+3 times)x2 + 4 hidden hours,
                // or 16 with pay (+ 4 hidden rate cells).
                // Phase 3 (2026-05-26): split the old 2-cell "Position" header
                // into Position + Specialty, each 1 cell wide. Total still 8.
                const r1Spans = { pos: 1, spc: 1, emp: 2, start: 2, end: 2 };
                const phantomSpan = showBill ? 8 : 4;
                // Total table column count for the per-employee summary
                // row's colSpan: 12 visible + 4 hidden hours + 4 hidden rate
                // (if pay) + 1 action = 13 (no pay) or 17 (with pay).
                const totalCols = (showBill ? 16 : 12) + 1;
                return (
              <table className="timesheet-grid line-table">
                <colgroup>
                  <col style={{ width: "18%" }} />{/* Sign IN 1 */}
                  <col style={{ width: "9%"  }} />{/* Time IN 1 */}
                  <col style={{ width: "9%"  }} />{/* Time OUT 1 */}
                  <col style={{ width: "7%"  }} />{/* Meal 1 */}
                  <col style={{ width: "18%" }} />{/* Sign IN 2 */}
                  <col style={{ width: "9%"  }} />{/* Time IN 2 */}
                  <col style={{ width: "9%"  }} />{/* Time OUT 2 */}
                  <col style={{ width: "21%" }} />{/* Meal 2 (absorbs remaining) */}
                  <col className="col-hidden" />{/* STD HRS */}
                  <col className="col-hidden" />{/* OT HRS */}
                  <col className="col-hidden" />{/* DT HRS */}
                  <col className="col-hidden" />{/* TOTAL HRS */}
                  {showBill && <>
                    <col className="col-hidden" />{/* STD BILL */}
                    <col className="col-hidden" />{/* OT BILL */}
                    <col className="col-hidden" />{/* DT BILL */}
                    <col className="col-hidden" />{/* TOTAL BILL */}
                  </>}
                  <col className="col-hidden" />{/* Action */}
                </colgroup>
                <thead>
                  <tr>
                    <th colSpan={r1Spans.emp}>Name</th>
                    <th colSpan={r1Spans.pos}>Position</th>
                    <th colSpan={r1Spans.spc}>Specialty</th>
                    <th colSpan={r1Spans.start}>Start Date</th>
                    <th colSpan={r1Spans.end}>End Date</th>
                    <th colSpan={phantomSpan}>{jobHasShifts ? "Shift" : ""}</th>
                    <th rowSpan={2} className="hide-print" style={{ minWidth: 90 }}>
                      {!hideBillAlways && timesheet.rows.length > 0 && (() => {
                        const allSel = timesheet.rows.every((r) => selectedIds.has(r.id));
                        const someSel = !allSel && timesheet.rows.some((r) => selectedIds.has(r.id));
                        return (
                          <input
                            type="checkbox"
                            aria-label="Select all rows"
                            checked={allSel}
                            ref={(el) => { if (el) el.indeterminate = someSel; }}
                            onChange={toggleAllRowsSelected}
                            style={{ marginRight: 6 }}
                          />
                        );
                      })()}
                      Status
                    </th>
                  </tr>
                  <tr>
                    <th className="sig-box-th">Sign IN 1</th>
                    <th>Time IN 1</th><th>Time OUT 1</th><th>Meal 1</th>
                    <th className="sig-box-th">Sign IN 2</th>
                    <th>Time IN 2</th><th>Time OUT 2</th><th>Meal 2</th>
                    <th className="hide-print">STD HRS</th>
                    <th className="hide-print">OT HRS</th>
                    <th className="hide-print">DT HRS</th>
                    <th className="hide-print">TOTAL HRS</th>
                    {showBill ? <>
                      <th className="hide-print" title="Billing rate (not pay). Pay lives on the Payroll screen.">STD BILL</th>
                      <th className="hide-print" title="Billing rate (not pay). Pay lives on the Payroll screen.">OT BILL</th>
                      <th className="hide-print" title="Billing rate (not pay). Pay lives on the Payroll screen.">DT BILL</th>
                      <th className="hide-print" title="Billing total = hours × billing rates. Pay total lives on the Payroll screen.">TOTAL BILL</th>
                    </> : null}
                  </tr>
                </thead>
                {dayGroups.map(([day, dayRows], dayGroupIdx) => {
                  const isCollapsed = isDayCollapsed(day);
                  const prevDayKey = dayGroupIdx > 0 ? dayGroups[dayGroupIdx - 1][0] : null;
                  const dayLabel = day === "no-date"
                    ? "(no date)"
                    : (() => {
                        const d = new Date(day + "T00:00:00");
                        const wd = d.toLocaleDateString(undefined, { weekday: "short" });
                        return `${wd} ${day}`;
                      })();
                  const statusMix = dayRows.reduce((acc, r) => {
                    acc[r.status] = (acc[r.status] || 0) + 1;
                    return acc;
                  }, {} as Record<string, number>);
                  // Phase 4: day is "holiday" if the planner flagged its
                  // job_request_days row OR every entry on the day has
                  // isHoliday=true (handles legacy + manually-set rows).
                  const dayIsHoliday = (day !== "no-date" && holidayDateSet.has(day))
                    || (dayRows.length > 0 && dayRows.every((r) => !!r.isHoliday));
                  return (
                  <Fragment key={day}>
                    {/* Print page break — fires before every day except the
                        first. The marker tr is display:none on screen so the
                        editing grid is unaffected; on print it has zero
                        height + a page-break-before. Carries data-day so the
                        day-filter style block can hide it when the operator
                        chose a specific day (otherwise we'd page-break
                        between empty separators of hidden days). */}
                    {dayGroupIdx > 0 && (
                      <tbody className="print-pagebreak" data-day={day}>
                        <tr className="print-pagebreak">
                          <td colSpan={totalCols}></td>
                        </tr>
                      </tbody>
                    )}
                    <tbody className="day-separator" data-day={day}>
                      <tr onClick={() => toggleDay(day)} style={{ cursor: "pointer" }}>
                        <td colSpan={totalCols} style={{
                          padding: "10px 14px",
                          background: isCollapsed ? "#f7f4ee" : (dayIsHoliday ? "#7a4a00" : "var(--accent, #2563eb)"),
                          color: isCollapsed ? "inherit" : "#fff",
                          borderBottom: "2px solid #333",
                        }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                            <span style={{ fontSize: 14, width: 14 }}>{isCollapsed ? "▸" : "▾"}</span>
                            <strong style={{ fontSize: 14 }}>{dayLabel}</strong>
                            {dayIsHoliday && (
                              <span style={{ fontSize: 12, fontWeight: 700, padding: "2px 8px", background: "#fff7e0", color: "#7a5a1a", borderRadius: 8 }}>
                                🎄 Holiday · {Number(effectiveHolidayMultiplier)}× rate
                              </span>
                            )}
                            <span style={{ fontSize: 12, opacity: 0.85 }}>
                              · {dayRows.length} crew member{dayRows.length === 1 ? "" : "s"}
                            </span>
                            <span style={{ fontSize: 12, opacity: 0.85 }}>
                              {statusMix.approved ? `· ${statusMix.approved} approved ` : ""}
                              {statusMix.submitted ? `· ${statusMix.submitted} pending ` : ""}
                              {statusMix.rejected ? `· ${statusMix.rejected} rejected ` : ""}
                            </span>
                            <span style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                              {prevDayKey && prevDayKey !== "no-date" && day !== "no-date" && (
                                <button
                                  type="button"
                                  className="hide-print"
                                  onClick={(e) => { e.stopPropagation(); duplicateDay(prevDayKey, day); }}
                                  title={`Copy entries from ${prevDayKey} to ${day}`}
                                  style={{
                                    fontSize: 11,
                                    padding: "3px 10px",
                                    background: isCollapsed ? "#fff" : "rgba(255,255,255,0.18)",
                                    color: isCollapsed ? "#1a1a1a" : "#fff",
                                    border: isCollapsed ? "1px solid #d7c6aa" : "1px solid rgba(255,255,255,0.4)",
                                    borderRadius: 6,
                                    cursor: "pointer",
                                  }}
                                >Copy ↑ prev day</button>
                              )}
                              {day !== "no-date" && dayRows.length > 0 && (
                                <button
                                  type="button"
                                  className="hide-print"
                                  onClick={(e) => { e.stopPropagation(); copyDayToNewDate(day); }}
                                  title="Copy this day's entries to a new date"
                                  style={{
                                    fontSize: 11,
                                    padding: "3px 10px",
                                    background: isCollapsed ? "#fff" : "rgba(255,255,255,0.18)",
                                    color: isCollapsed ? "#1a1a1a" : "#fff",
                                    border: isCollapsed ? "1px solid #d7c6aa" : "1px solid rgba(255,255,255,0.4)",
                                    borderRadius: 6,
                                    cursor: "pointer",
                                  }}
                                >Copy → new day…</button>
                              )}
                            </span>
                          </div>
                        </td>
                      </tr>
                    </tbody>
                    {!isCollapsed && dayRows.map((row, dayIdx) => {
                    const idx = rowIndexById.get(row.id) ?? 0;
                    const band = `line-band-${idx % 4}`;
                    const unlinked = !row.employeeKey;
                    // Freeze guard: while status='approved' the DB rejects content
                    // changes. Mirror that in the UI so inputs are disabled instead
                    // of silently no-oping on save. Invoice-bound rows are double
                    // locked (also can't be un-approved) — visually the same here.
                    const isLocked = row.status === "approved";
                    const lockedClass = isLocked ? " line-locked" : "";
                    return (
                    <tbody key={row.id} className={`line-employee ${isCollapsed ? "is-collapsed-day" : ""}`} data-day={row.workDate || "no-date"}>
                    <tr className={`line-row ${band}${unlinked ? " line-unlinked" : ""}${lockedClass}`} style={isLocked ? { opacity: 0.85 } : undefined}>
                      <td colSpan={r1Spans.emp}>
                        <span className="record-id" title="Timesheet entry id">{row.id}</span>
                        {isLocked ? (
                          <div style={{ fontSize: 13, fontWeight: 600 }}>
                            {[row.firstName, row.lastName].filter(Boolean).join(" ") || row.email || "(unnamed)"}
                          </div>
                        ) : (
                          <>
                            <span className="print-time" style={{ fontSize: 13, fontWeight: 600 }}>
                              {[row.firstName, row.lastName].filter(Boolean).join(" ") || row.email || "(unnamed)"}
                            </span>
                            <div className="hide-print">
                            <LazyEmployeePicker
                              employeeKey={row.employeeKey}
                              displayName={[row.firstName, row.lastName].filter(Boolean).join(" ") || undefined}
                              fallbackName={!row.employeeKey ? ([row.firstName, row.lastName].filter(Boolean).join(" ") || undefined) : undefined}
                              onSelect={(emp) => updateRow(row.id, {
                                employeeKey: emp.employeeKey,
                                firstName: emp.firstName || emp.fullName.split(" ")[0] || "",
                                lastName: emp.lastName || emp.fullName.split(" ").slice(1).join(" ") || "",
                                phone: emp.phone || "",
                                email: emp.email || "",
                                status: row.status === "approved" ? "approved" : "submitted",
                              })}
                              onCreateInline={async (typedName) => {
                                // Add to employee master on the fly so the
                                // person becomes searchable for future rows
                                // and the timesheet entry has a real FK to
                                // hang payroll / assignments off of.
                                const parts = typedName.trim().split(/\s+/);
                                const firstName = parts[0] ?? "";
                                const lastName  = parts.slice(1).join(" ");
                                const fullName  = [firstName, lastName].filter(Boolean).join(" ") || typedName.trim();
                                const newEmployee: EmployeeRecord = {
                                  employeeKey: `emp-${Date.now()}`,
                                  fullName,
                                  firstName,
                                  lastName,
                                  type: "contractor",  // default; user can change in Maintenance
                                  // Auto-stamp hire date with today so HR's
                                  // onboarding backlog catches this person
                                  // without coordinator action.
                                  hireDate: new Date().toISOString().slice(0, 10),
                                };
                                upsertEmployee(newEmployee);
                                setRefreshKey((k) => k + 1);
                                // Hand the same record back to EmployeePicker as
                                // a PickerEmployee — it'll call onSelect with it
                                // and push it into the module-level cache so
                                // other pickers on the page see it immediately.
                                const picked: PickerEmployee = {
                                  employeeKey: newEmployee.employeeKey,
                                  fullName,
                                  firstName,
                                  lastName,
                                  email: "",
                                  phone: "",
                                };
                                pushEmployeeIntoCache(picked);
                                return picked;
                              }}
                            />
                            {unlinked ? <div className="unlinked-hint">⚠ Link an employee to enable this row</div> : null}
                            </div>
                          </>
                        )}
                      </td>
                      {/* Position cell — Phase 3: drives positionId; legacy
                          text `position` is kept in sync for back-compat. */}
                      <td colSpan={r1Spans.pos}>
                        <select
                          className="input-tight"
                          value={row.positionId || ""}
                          disabled={isLocked}
                          onChange={(e) => {
                            const newPosId = e.target.value || null;
                            const newPosName = newPosId ? (positionNameById.get(newPosId) || "") : "";
                            // If the current specialty doesn't belong to the new
                            // position, clear it so the cascading constraint holds.
                            const validSpc = row.specialtyId
                              && allSpecialties.some((s) => s.id === row.specialtyId && s.positionId === newPosId);
                            updateRow(row.id, {
                              positionId: newPosId,
                              position: newPosName || row.position,
                              specialtyId: validSpc ? row.specialtyId : null,
                            });
                          }}
                        >
                          <option value="">{row.position && !row.positionId ? `${row.position} (legacy)` : "— pick —"}</option>
                          {allPositions.map((p) => (
                            <option key={p.id} value={p.id}>{p.name}</option>
                          ))}
                        </select>
                        <span className="print-time">{positionNameById.get(row.positionId || "") || row.position || ""}</span>
                      </td>
                      {/* Specialty cell — Phase 3: filtered by current positionId.
                          Disabled when no position is set yet. */}
                      <td colSpan={r1Spans.spc}>
                        <select
                          className="input-tight"
                          value={row.specialtyId || ""}
                          disabled={isLocked || !row.positionId || !requiresSpecialty(row.positionId)}
                          onChange={(e) => updateRow(row.id, { specialtyId: e.target.value || null })}
                          title={
                            !row.positionId
                              ? "Pick a position first"
                              : !requiresSpecialty(row.positionId)
                                ? "This position has no specialty choices in the master"
                                : !row.specialtyId
                                  ? "Specialty is required to approve — pick the specific role (payroll uses it to look up pay rate)"
                                  : ""
                          }
                          required={requiresSpecialty(row.positionId)}
                          style={
                            requiresSpecialty(row.positionId) && !row.specialtyId && !isLocked
                              ? { background: "#fff4d6", borderColor: "#e0c070" }
                              : undefined
                          }
                        >
                          <option value="">
                            {!row.positionId
                              ? "—"
                              : !requiresSpecialty(row.positionId)
                                ? "— n/a —"
                                : "— required —"}
                          </option>
                          {specialtiesFor(row.positionId).map((s) => (
                            <option key={s.id} value={s.id}>{s.name}</option>
                          ))}
                        </select>
                        <span className="print-time">{specialtyNameById.get(row.specialtyId || "") || ""}</span>
                      </td>
                      <td colSpan={r1Spans.start}>
                        <input
                          type="date"
                          className="input-tight"
                          disabled={isLocked}
                          value={row.workDate ?? ""}
                          onChange={(e) => {
                            const d = e.target.value;
                            // Phase 4: auto-flip isHoliday when the new date is
                            // flagged on the job. Honors prior manual override:
                            // if the operator deliberately unchecked the holiday
                            // box on a flagged day, we don't re-flip on date change.
                            // (Heuristic: only auto-set if isHoliday is currently
                            // false AND the new date is in the holiday set; we
                            // intentionally don't auto-clear when moving off.)
                            const patch: Partial<TimeEntry> = {
                              workDate: d,
                              endDate: row.endDate || d,
                            };
                            if (d && holidayDateSet.has(d) && !row.isHoliday) {
                              patch.isHoliday = true;
                              patch.holidayMultiplier = effectiveHolidayMultiplier;
                            }
                            updateRow(row.id, patch);
                          }}
                        />
                        <span className="print-time">{row.workDate || ""}</span>
                      </td>
                      <td colSpan={r1Spans.end}>
                        <input type="date" className="input-tight" disabled={isLocked} value={row.endDate ?? ""} onChange={(e)=>updateRow(row.id, { endDate: e.target.value })} />
                        <span className="print-time">{row.endDate || ""}</span>
                        {(() => {
                          const in1 = parseMinutes(row.timeIn1 ?? "");
                          const out1 = parseMinutes(row.timeOut1 ?? "");
                          const in2 = parseMinutes(row.timeIn2 ?? "");
                          const out2 = parseMinutes(row.timeOut2 ?? "");
                          const pair1Crosses = in1 != null && out1 != null && out1 < in1;
                          const pair2Crosses = in2 != null && out2 != null && out2 < in2;
                          const sameDay = row.workDate && row.endDate && row.workDate === row.endDate;
                          if (sameDay && (pair1Crosses || pair2Crosses)) {
                            return <div style={{ fontSize: 10, color: "#c2410c", marginTop: 2 }}>shift crosses midnight — advance End Date?</div>;
                          }
                          return null;
                        })()}
                      </td>
                      {/* Shift cell — note: NOT className="hide-print". The
                          phantom span is otherwise empty layout filler, but
                          when shifts are defined we want the picked shift
                          label to print on the sign-in sheet so the crew
                          knows which shift they signed in to. */}
                      <td colSpan={phantomSpan} style={{ verticalAlign: "middle" }}>
                        {jobHasShifts && (
                          <>
                            <div className="hide-print" style={{ display: "flex", alignItems: "center" }}>
                              <select
                                className="input-tight"
                                value={row.shiftId || ""}
                                disabled={isLocked}
                                onChange={(e) => updateRow(row.id, { shiftId: e.target.value || null })}
                                title={
                                  !row.shiftId
                                    ? "Shift is required to approve — payroll groups daily rules by shift"
                                    : ""
                                }
                                required
                                style={{
                                  fontSize: 11,
                                  width: "auto",
                                  maxWidth: 180,
                                  ...(!row.shiftId && !isLocked
                                    ? { background: "#fff4d6", borderColor: "#e0c070" }
                                    : {}),
                                }}
                              >
                                <option value="">🕒 — required —</option>
                                {Array.from(shiftLabelById.entries()).map(([id, label]) => (
                                  <option key={id} value={id}>🕒 {label}</option>
                                ))}
                              </select>
                            </div>
                            <span className="print-time" style={{ fontWeight: 600 }}>
                              {row.shiftId ? (shiftLabelById.get(row.shiftId) || "") : ""}
                            </span>
                          </>
                        )}
                      </td>
                      <td rowSpan={2} className="hide-print" style={{ verticalAlign: "middle", padding: "6px 8px" }}>
                        <div style={{
                          display: "flex",
                          flexDirection: "column",
                          alignItems: "stretch",
                          gap: 6,
                          minWidth: 110,
                        }}>
                          {/* 1. Bulk select checkbox, with a label so it's obvious
                              what it does (the column header "Status" doesn't make
                              it clear). */}
                          {!hideBillAlways && (
                            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "#666" }}>
                              <input
                                type="checkbox"
                                aria-label="Select row for bulk actions"
                                checked={selectedIds.has(row.id)}
                                onChange={() => toggleRowSelected(row.id)}
                                disabled={!!busyBatch}
                              />
                              Select
                            </label>
                          )}
                          {/* 2. Status pill — exactly one renders per row. Centered
                              and full width within the column for a consistent
                              vertical rhythm. */}
                          {row.employeeKey && row.status === "approved" && (
                            <span className="badge pill-green"
                                  style={{ fontSize: 11, textAlign: "center", padding: "3px 8px" }}
                                  title={row.invoiceLineId ? "Approved AND billed onto an invoice line — unlink invoice first to change anything" : "Approved — unlock to edit"}>
                              {row.invoiceLineId ? "🔒 Billed" : "🔒 Approved"}
                            </span>
                          )}
                          {row.employeeKey && row.status === "rejected" && (
                            <span className="badge"
                                  style={{ fontSize: 11, background: "#fde8e8", color: "#c0392b", textAlign: "center", padding: "3px 8px" }}>
                              Rejected
                            </span>
                          )}
                          {row.employeeKey && row.status === "submitted" && (
                            <span className="badge"
                                  style={{ fontSize: 11, background: "#e8f0fe", color: "#1a56c4", textAlign: "center", padding: "3px 8px" }}>
                              Pending
                            </span>
                          )}
                          {/* 3. Holiday — READ-ONLY badge. Driven by the day-level
                              flag on job_request_days.is_holiday (Connor flips it on
                              the job's daily requirements). Holiday is a property
                              of the day, not the individual entry — every crew
                              member working a holiday is on holiday pay. The
                              per-row toggle that used to live here was a UX trap:
                              it implied you could pay Bruno at holiday rate while
                              Sarah on the same day wasn't, which isn't how it
                              works. Architectural follow-up: a `timesheet_days`
                              table (peer of job_request_days) so the holiday flag
                              lives in ONE place; tracked in project_todo.md. */}
                          {(row.workDate && holidayDateSet.has(row.workDate)) && (
                            <span className="badge"
                                  style={{ fontSize: 11, background: "#fff7e0", color: "#7a5a1a", textAlign: "center", padding: "3px 8px" }}
                                  title="This day is flagged as a holiday — pay multiplier applied. Change the day flag on the job's daily requirements.">
                              🎄 Holiday {Number(effectiveHolidayMultiplier)}×
                            </span>
                          )}
                          {/* 4. Per-row Delete (escape hatch — bulk Delete is in
                              the batch action bar). Pushed to the bottom of the
                              cell. Disabled while approved — the DB freeze
                              trigger would reject the delete anyway. */}
                          <button
                            className="secondary"
                            onClick={() => removeRow(row.id)}
                            disabled={isLocked}
                            title={isLocked ? "Unlock this entry first to delete it" : "Remove this row from the timesheet on next save"}
                            style={{ padding: "3px 8px", fontSize: 11, marginTop: 2 }}
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                    <tr className={`line-row line-row-end ${band}${lockedClass}`} style={isLocked ? { opacity: 0.85 } : undefined}>
                      <td className="sig-box"></td>
                      <td>
                        <LazyTimeSelect ariaLabel="Time In 1" value={row.timeIn1} options={TIMES} disabled={isLocked}
                          onChange={(v) => updateRow(row.id, { timeIn1: v })} />
                        <span className="print-time">{row.timeIn1 || ""}</span>
                      </td>
                      <td>
                        <LazyTimeSelect ariaLabel="Time Out 1" value={row.timeOut1} options={TIMES} disabled={isLocked}
                          onChange={(v) => updateRow(row.id, { timeOut1: v })} />
                        <span className="print-time">{row.timeOut1 || ""}</span>
                      </td>
                      <td><select className="input-tight" disabled={isLocked} value={row.mealBreak1Minutes ?? row.lunchMinutes ?? 0} onChange={(e)=>updateRow(row.id, { mealBreak1Minutes:Number(e.target.value) })}>{mealBreakOptions().map((t)=><option key={t} value={t}>{t}</option>)}</select><span className="print-time">{row.mealBreak1Minutes ?? row.lunchMinutes ?? 0}</span></td>
                      <td className="sig-box"></td>
                      <td>
                        <LazyTimeSelect ariaLabel="Time In 2" value={row.timeIn2} options={TIMES} disabled={isLocked}
                          onChange={(v) => updateRow(row.id, { timeIn2: v })} />
                        <span className="print-time">{row.timeIn2 || ""}</span>
                      </td>
                      <td>
                        <LazyTimeSelect ariaLabel="Time Out 2" value={row.timeOut2} options={TIMES} disabled={isLocked}
                          onChange={(v) => updateRow(row.id, { timeOut2: v })} />
                        <span className="print-time">{row.timeOut2 || ""}</span>
                      </td>
                      <td><select className="input-tight" disabled={isLocked} value={row.mealBreak2Minutes ?? 0} onChange={(e)=>updateRow(row.id, { mealBreak2Minutes:Number(e.target.value) })}>{mealBreakOptions().map((t)=><option key={t} value={t}>{t}</option>)}</select><span className="print-time">{row.mealBreak2Minutes ?? 0}</span></td>
                      <td className="hide-print">{row.stdHours.toFixed(2)}</td>
                      <td className="hide-print">{row.otHours.toFixed(2)}</td>
                      <td className="hide-print">{row.dtHours.toFixed(2)}</td>
                      <td className="hide-print">{row.totalHours.toFixed(2)}</td>
                      {showBill ? (() => {
                        // Bill rates come from the rate-card snapshot on the
                        // job's quote (see lib/store/invoices.ts:686 — invoice
                        // generation uses the rate card, NOT the timesheet's
                        // stored bill rates). We display rate-card values when
                        // available, falling back to the row's stored values
                        // for back-compat. Read-only display kills ~1,200
                        // option DOM nodes per row that used to live in the
                        // 300-option rate dropdowns.
                        const rcRow = row.specialtyId ? rateCardBySpecialty.get(row.specialtyId) : undefined;
                        const stdR = rcRow?.hourly ?? row.billStdRate;
                        const otR  = rcRow?.otRate ?? row.billOtRate;
                        const dtR  = rcRow?.dtRate ?? row.billDtRate;
                        const fromRC = !!rcRow;
                        const cellStyle = {
                          fontSize: 11,
                          color: fromRC ? "#1a1a1a" : "#888",
                          fontStyle: fromRC ? "normal" : "italic" as const,
                        };
                        const title = fromRC
                          ? "Live rate from this job's rate card (read-only — change on the rate card)"
                          : "Fallback rate stored on the row — no rate-card match for this specialty";
                        return (
                          <>
                            <td className="hide-print" style={cellStyle} title={title}>{stdR}</td>
                            <td className="hide-print" style={cellStyle} title={row.isHoliday ? "Inert on holiday rows — bill uses base × multiplier" : title}>{otR}</td>
                            <td className="hide-print" style={cellStyle} title={row.isHoliday ? "Inert on holiday rows — bill uses base × multiplier" : title}>{dtR}</td>
                            <td className="hide-print">${row.billTotal.toFixed(2)}</td>
                          </>
                        );
                      })() : null}
                    </tr>
                    </tbody>
                    );
                    })}
                  </Fragment>
                  );
                })}
                <tfoot className="hide-print">
                  <tr>
                    <th colSpan={8}>Totals</th>
                    <th>{totals.stdHours.toFixed(2)}</th>
                    <th>{totals.otHours.toFixed(2)}</th>
                    <th>{totals.dtHours.toFixed(2)}</th>
                    <th>{totals.totalHours.toFixed(2)}</th>
                    {showBill ? <><th></th><th></th><th></th><th>${totals.billTotal.toFixed(2)}</th></> : null}
                    <th></th>
                  </tr>
                </tfoot>
              </table>
                );
              })()}
            </div>

            <div className="hide-print" style={{ marginTop: 16 }}>
              <h3 className="section-title">Labor Summary for Quotes</h3>
              <p className="muted" style={{ fontSize: 12, marginTop: -6, marginBottom: 8 }}>
                All entries on this job, regardless of approval status — useful for validating actuals vs. the quote.
              </p>
              <div style={{ overflowX: "auto" }}>
                <table>
                  <thead><tr><th>Position</th><th>Workers</th><th>STD Hours</th><th>OT Hours</th><th>DT Hours</th><th>Total Hours</th>{!hideBillAlways && <th>Total Bill</th>}</tr></thead>
                  <tbody>
                    {summary.length === 0 ? (
                      <tr><td colSpan={hideBillAlways ? 6 : 7} className="muted" style={{ textAlign: "center" }}>No entries.</td></tr>
                    ) : summary.map((r) => (
                      <tr key={r.position}>
                        <td>{r.position}</td>
                        <td>{r.workers}</td>
                        <td>{r.stdHours.toFixed(2)}</td>
                        <td>{r.otHours.toFixed(2)}</td>
                        <td>{r.dtHours.toFixed(2)}</td>
                        <td>{r.totalHours.toFixed(2)}</td>
                        {!hideBillAlways && <td>${r.billTotal.toFixed(2)}</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="hide-print" style={{ marginTop: 16 }}>
              <h3 className="section-title">Labor Summary for Invoices</h3>
              <p className="muted" style={{ fontSize: 12, marginTop: -6, marginBottom: 8 }}>
                Approved entries only — this is what "Pull labor actuals from timesheets" uses on the invoice.
              </p>
              <div style={{ overflowX: "auto" }}>
                <table>
                  <thead><tr><th>Position</th><th>Workers</th><th>STD Hours</th><th>OT Hours</th><th>DT Hours</th><th>Total Hours</th>{!hideBillAlways && <th>Total Bill</th>}</tr></thead>
                  <tbody>
                    {approvedSummary.length === 0 ? (
                      <tr><td colSpan={hideBillAlways ? 6 : 7} className="muted" style={{ textAlign: "center" }}>No approved entries yet.</td></tr>
                    ) : approvedSummary.map((r) => (
                      <tr key={r.position}>
                        <td>{r.position}</td>
                        <td>{r.workers}</td>
                        <td>{r.stdHours.toFixed(2)}</td>
                        <td>{r.otHours.toFixed(2)}</td>
                        <td>{r.dtHours.toFixed(2)}</td>
                        <td>{r.totalHours.toFixed(2)}</td>
                        {!hideBillAlways && <td>${r.billTotal.toFixed(2)}</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>

      {!hideBillAlways && pendingEntries.length > 0 && (
        <div className="card hide-print">
          <h3 className="section-title">⏳ Staff Submissions Pending Review ({pendingEntries.length})</h3>
          <div style={{ overflowX: "auto" }}>
            <table>
              <thead>
                <tr>
                  <th>Name</th><th>Position</th><th>Start Date</th><th>Time In</th><th>Time Out</th>
                  <th>Meal Break</th><th>STD</th><th>OT</th><th>DT</th><th>Total Hrs</th><th>Action</th>
                </tr>
              </thead>
              <tbody>
                {pendingEntries.map((entry) => (
                  <tr key={entry.id}>
                    <td>{entry.firstName} {entry.lastName}</td>
                    <td>{entry.position}</td>
                    <td>{(entry as any).workDate || "—"}</td>
                    <td>{entry.timeIn1 || "—"}</td>
                    <td>{entry.timeOut1 || "—"}</td>
                    <td>{((entry.mealBreak1Minutes ?? entry.lunchMinutes ?? 0) + (entry.mealBreak2Minutes ?? 0))}m</td>
                    <td>{entry.stdHours.toFixed(2)}</td>
                    <td>{entry.otHours.toFixed(2)}</td>
                    <td>{entry.dtHours.toFixed(2)}</td>
                    <td><strong>{entry.totalHours.toFixed(2)}</strong></td>
                    <td>
                      <div className="action-row">
                        <button onClick={() => handleApprove(entry)}>✓ Approve</button>
                        <button className="secondary" onClick={() => handleReject(entry.id)}>✗ Reject</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* "+ Add Crew Member" modal — picker first, row second. */}
      {addCrewModalOpen && (
        <div
          onClick={() => setAddCrewModalOpen(false)}
          style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)",
            zIndex: 3000, display: "flex", alignItems: "center", justifyContent: "center",
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "min(480px, 95vw)", background: "#fff", borderRadius: 12,
              boxShadow: "0 20px 60px rgba(0,0,0,0.3)", padding: 18,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <h3 style={{ margin: 0, fontSize: 16 }}>+ Add Crew Member</h3>
              <button type="button" onClick={() => setAddCrewModalOpen(false)} style={{ background: "transparent", border: "none", fontSize: 18, cursor: "pointer" }} title="Cancel (esc)">✕</button>
            </div>
            <div className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
              Pick the person who worked. A new timesheet row will be added for them.
              Searching by name not finding the person? Type their full name then use
              &ldquo;+ Create employee&rdquo; to add them to the directory inline.
            </div>
            <EmployeePicker
              employeeKey={null}
              defaultOpen
              onSelect={(emp) => {
                addRowForEmployee(emp);
                setAddCrewModalOpen(false);
              }}
              onCreateInline={async (typedName) => {
                const parts = typedName.trim().split(/\s+/);
                const firstName = parts[0] ?? "";
                const lastName  = parts.slice(1).join(" ");
                const fullName  = [firstName, lastName].filter(Boolean).join(" ") || typedName.trim();
                const newEmployee: EmployeeRecord = {
                  employeeKey: `emp-${Date.now()}`,
                  fullName, firstName, lastName,
                  type: "contractor",
                  hireDate: new Date().toISOString().slice(0, 10),
                };
                upsertEmployee(newEmployee);
                setRefreshKey((k) => k + 1);
                const picked: PickerEmployee = {
                  employeeKey: newEmployee.employeeKey,
                  fullName, firstName, lastName, email: "", phone: "",
                };
                pushEmployeeIntoCache(picked);
                return picked;
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
