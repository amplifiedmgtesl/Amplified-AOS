/**
 * Crew-roster spreadsheet — EXPORT side.
 *
 * Builds a self-contained .xlsx workbook for a job's coordinator: pre-filled
 * crew slots (one row per needed seat), the active employee roster, the valid
 * roles for the job, a human-readable Job Info tab, and a very-hidden machine
 * stamp the importer's job-identity guard checks.
 *
 * Source of the slots = "requirements" (job_request_crew_needs) or "quote"
 * (the active quote's lines). See docs/crew-roster-spreadsheet-spec.md.
 */

import { supabase } from "@/lib/supabase/client";
import { loadJobRequestDays, loadCrewNeedsForRequest } from "./job-request-days";
import { loadShifts } from "./job-request-shifts";
import { loadAssignmentsForRequest } from "./job-request-assignments";
import {
  resolveActiveQuoteForJob,
  loadQuote,
  resolveRateCardForJob,
} from "@/lib/store/quotes";
import type {
  JobRequest,
  JobRequestDay,
  JobRequestShift,
  Position,
  Specialty,
} from "@/lib/store/types";
import {
  SHEET,
  CREW_COL,
  CREW_HEADERS,
  CREW_FIRST_HIDDEN_COL,
  EMP_COL,
  EMP_HEADERS,
  ROLE_COL,
  ROLE_HEADERS,
  MAX_LIST_ROWS,
  ROSTER_SCHEMA_VERSION,
  CONFIRMED_YES,
  CONFIRMED_NO,
  type RosterSource,
  type RosterMeta,
} from "./crew-roster-schema";

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** 1-based column index → Excel column letter (7 → "G"). */
function colLetter(n: number): string {
  let s = "";
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

export type RosterSlotRow = {
  eventDate: string;
  day: string;
  shiftLabel: string;
  call: string;
  start: string;
  end: string;
  specialtyName: string;
  positionName: string;
  employeeName: string;
  confirmed: boolean;
  notes: string;
  status: string;
  // hidden binding ids
  dayId: string;
  shiftId: string;
  specialtyId: string;
  positionId: string;
  assignmentId: string;
};

export type RosterRoleRow = { positionName: string; specialtyName: string; specialtyId: string };

export type RosterEmployeeRow = {
  fullName: string;
  first: string;
  last: string;
  phone: string;
  email: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  employeeKey: string;
};

export type RosterReconcileRow = {
  role: string;
  needed: number;
  assigned: number;
  delta: number; // assigned - needed; >0 over, <0 under
};

export type RosterData = {
  job: JobRequest;
  source: RosterSource;
  quoteDisplayCode?: string;
  quoteId?: string;
  dateRange: string;
  slots: RosterSlotRow[];
  employees: RosterEmployeeRow[];
  roles: RosterRoleRow[];
  reconciliation: RosterReconcileRow[];
};

// ─── Data gathering ──────────────────────────────────────────────────────────

function jobInfoRowToJobRequest(r: any): JobRequest {
  // Partial map — only the fields the workbook + meta need.
  return {
    id: r.id,
    clientId: r.client_id ?? undefined,
    client: r.client ?? "",
    eventName: r.event_name ?? "",
    venue: r.venue ?? "",
    venueAddress: r.venue_address ?? "",
    city: r.city ?? "",
    state: r.state ?? "",
    cityState: r.city_state ?? "",
    receivedDate: r.received_date ?? "",
    requestDate: r.request_date ?? "",
    endDate: r.end_date ?? undefined,
    startTime: r.start_time ?? "",
    endTime: r.end_time ?? "",
    status: r.status ?? "",
    notes: r.notes ?? "",
    attachmentNames: [],
    packetNotes: "",
    jobNo: r.job_no ?? undefined,
  };
}

function slotKey(dayId: string, shiftId: string, specialtyId: string): string {
  return `${dayId}::${shiftId || ""}::${specialtyId || ""}`;
}

/** Pull everything the workbook needs for a job + chosen source. */
export async function gatherRoster(
  jobRequestId: string,
  source: RosterSource,
): Promise<RosterData> {
  const jobRes = await supabase
    .from("job_requests")
    .select("*")
    .eq("id", jobRequestId)
    .maybeSingle();
  if (jobRes.error) throw jobRes.error;
  if (!jobRes.data) throw new Error("Job not found");
  const job = jobInfoRowToJobRequest(jobRes.data);

  const [days, shifts, posRes, spcRes, rateCard, assignments] = await Promise.all([
    loadJobRequestDays(jobRequestId),
    loadShifts(jobRequestId),
    supabase.from("positions").select("*").eq("is_active", true).order("sort_order"),
    supabase.from("specialties").select("*").eq("is_active", true).order("sort_order"),
    resolveRateCardForJob(jobRequestId),
    loadAssignmentsForRequest(jobRequestId),
  ]);
  if (posRes.error) throw posRes.error;
  if (spcRes.error) throw spcRes.error;

  const positions: Position[] = (posRes.data ?? []).map((r: any) => ({
    id: r.id, name: r.name, sortOrder: r.sort_order, isActive: r.is_active,
  }));
  const specialties: Specialty[] = (spcRes.data ?? []).map((r: any) => ({
    id: r.id, positionId: r.position_id, name: r.name, sortOrder: r.sort_order, isActive: r.is_active,
  }));
  const posById = new Map(positions.map((p) => [p.id, p]));
  const spcById = new Map(specialties.map((s) => [s.id, s]));
  const dayById = new Map(days.map((d) => [d.id, d]));
  const dayByDate = new Map(days.map((d) => [d.eventDate, d]));
  const shiftById = new Map(shifts.map((s: JobRequestShift) => [s.id, s]));

  const positionNameForSpecialty = (specialtyId?: string): { posId: string; posName: string } => {
    const s = specialtyId ? spcById.get(specialtyId) : undefined;
    const p = s ? posById.get(s.positionId) : undefined;
    return { posId: p?.id ?? "", posName: p?.name ?? "" };
  };

  // ── Build the target seats from the chosen source ──
  type Target = {
    dayId: string;
    shiftId: string;
    specialtyId: string;
    status: string; // pre-set flag for bad rows (no day / no specialty)
  };
  const targets: Target[] = [];

  if (source === "requirements") {
    const needs = await loadCrewNeedsForRequest(jobRequestId);
    for (const n of needs) {
      const qty = Math.max(0, Math.round(n.quantity ?? 0));
      for (let i = 0; i < qty; i++) {
        targets.push({
          dayId: n.jobRequestDayId,
          shiftId: n.shiftId ?? "",
          specialtyId: n.specialtyId ?? "",
          status: n.specialtyId ? "" : "⚠ no specialty — set on the requirements tab",
        });
      }
    }
  } else {
    const active = await resolveActiveQuoteForJob(jobRequestId);
    if (!active) throw new Error("No active quote for this job. Pick Requirements as the source instead.");
    const quote = await loadQuote(active.id);
    if (!quote) throw new Error("Active quote could not be loaded.");
    for (const line of quote.lines) {
      const day = line.quoteDate ? dayByDate.get(line.quoteDate) : undefined;
      const crew = Math.max(0, Math.round(line.crewCount ?? line.qty ?? 0));
      let status = "";
      if (!line.quoteDate || !day) status = "⚠ quote line has no matching job day — fix the date";
      else if (!line.specialtyId) status = "⚠ quote line has no specialty — no derivable position";
      for (let i = 0; i < crew; i++) {
        targets.push({
          dayId: day?.id ?? "",
          shiftId: line.shiftId ?? "",
          specialtyId: line.specialtyId ?? "",
          status,
        });
      }
    }
  }

  // ── Pre-fill targets from existing assignments, matched per slot key ──
  const asgByKey = new Map<string, typeof assignments>();
  for (const a of assignments) {
    const k = slotKey(a.jobRequestDayId, a.shiftId ?? "", a.specialtyId ?? "");
    const arr = asgByKey.get(k) ?? [];
    arr.push(a);
    asgByKey.set(k, arr);
  }

  // employee names for prefill
  const empKeys = Array.from(new Set(assignments.map((a) => a.employeeKey).filter(Boolean))) as string[];
  const empNameByKey = new Map<string, string>();
  if (empKeys.length > 0) {
    const er = await supabase.from("employees").select("employee_key, full_name").in("employee_key", empKeys);
    if (er.error) throw er.error;
    for (const e of er.data ?? []) empNameByKey.set(e.employee_key, e.full_name ?? "");
  }

  const slots: RosterSlotRow[] = [];
  const consumed = new Set<string>(); // assignment ids consumed by a target

  const dayMeta = (dayId: string) => {
    const d: JobRequestDay | undefined = dayById.get(dayId);
    return {
      eventDate: d?.eventDate ?? "",
      day: d?.eventDate ? DOW[new Date(d.eventDate + "T00:00:00").getDay()] : "",
      call: d?.callTime ?? "",
      start: d?.startTime ?? "",
      end: d?.endTime ?? "",
    };
  };

  for (const t of targets) {
    const k = slotKey(t.dayId, t.shiftId, t.specialtyId);
    const pool = asgByKey.get(k) ?? [];
    const match = pool.find((a) => !consumed.has(a.id));
    if (match) consumed.add(match.id);
    const { posName } = positionNameForSpecialty(t.specialtyId);
    const m = dayMeta(t.dayId);
    slots.push({
      ...m,
      shiftLabel: t.shiftId ? (shiftById.get(t.shiftId)?.label ?? "") : "",
      specialtyName: t.specialtyId ? (spcById.get(t.specialtyId)?.name ?? "") : "",
      positionName: posName,
      employeeName: match?.employeeKey ? (empNameByKey.get(match.employeeKey) ?? "") : "",
      confirmed: !!match?.confirmed,
      notes: match?.notes ?? "",
      status: t.status,
      dayId: t.dayId,
      shiftId: t.shiftId,
      specialtyId: t.specialtyId,
      positionId: positionNameForSpecialty(t.specialtyId).posId,
      assignmentId: match?.id ?? "",
    });
  }

  // ── Leftover assignments = extras beyond current requirement ──
  for (const a of assignments) {
    if (consumed.has(a.id)) continue;
    const { posName, posId } = positionNameForSpecialty(a.specialtyId);
    const m = dayMeta(a.jobRequestDayId);
    slots.push({
      ...m,
      shiftLabel: a.shiftId ? (shiftById.get(a.shiftId)?.label ?? "") : "",
      specialtyName: a.specialtyId ? (spcById.get(a.specialtyId)?.name ?? "") : "",
      positionName: posName,
      employeeName: a.employeeKey ? (empNameByKey.get(a.employeeKey) ?? "") : "",
      confirmed: !!a.confirmed,
      notes: a.notes ?? "",
      status: "Extra — beyond current requirement",
      dayId: a.jobRequestDayId,
      shiftId: a.shiftId ?? "",
      specialtyId: a.specialtyId ?? "",
      positionId: posId,
      assignmentId: a.id,
    });
  }

  slots.sort(
    (x, y) =>
      x.eventDate.localeCompare(y.eventDate) ||
      x.shiftLabel.localeCompare(y.shiftLabel) ||
      x.positionName.localeCompare(y.positionName),
  );

  // ── Reconciliation: needed (targets) vs assigned, per role ──
  const neededByRole = new Map<string, number>();
  for (const t of targets) {
    const { posName } = positionNameForSpecialty(t.specialtyId);
    const label = `${posName || "?"} — ${t.specialtyId ? (spcById.get(t.specialtyId)?.name ?? "?") : "?"}`;
    neededByRole.set(label, (neededByRole.get(label) ?? 0) + 1);
  }
  const assignedByRole = new Map<string, number>();
  for (const a of assignments) {
    if (!a.employeeKey) continue;
    const { posName } = positionNameForSpecialty(a.specialtyId);
    const label = `${posName || "?"} — ${a.specialtyId ? (spcById.get(a.specialtyId)?.name ?? "?") : "?"}`;
    assignedByRole.set(label, (assignedByRole.get(label) ?? 0) + 1);
  }
  const allRoleLabels = new Set([...neededByRole.keys(), ...assignedByRole.keys()]);
  const reconciliation: RosterReconcileRow[] = Array.from(allRoleLabels)
    .sort()
    .map((role) => {
      const needed = neededByRole.get(role) ?? 0;
      const assigned = assignedByRole.get(role) ?? 0;
      return { role, needed, assigned, delta: assigned - needed };
    });

  // ── Valid Roles: rate-card specialties ∪ specialties used by this job ──
  const roleSpecIds = new Set<string>();
  for (const r of rateCard?.rows ?? []) if (r.specialty_id) roleSpecIds.add(r.specialty_id);
  for (const t of targets) if (t.specialtyId) roleSpecIds.add(t.specialtyId);
  for (const a of assignments) if (a.specialtyId) roleSpecIds.add(a.specialtyId);
  const roles: RosterRoleRow[] = Array.from(roleSpecIds)
    .map((sid) => {
      const s = spcById.get(sid);
      const p = s ? posById.get(s.positionId) : undefined;
      return { positionName: p?.name ?? "", specialtyName: s?.name ?? "", specialtyId: sid };
    })
    .filter((r) => r.specialtyName)
    .sort((a, b) => a.positionName.localeCompare(b.positionName) || a.specialtyName.localeCompare(b.specialtyName));

  // ── Employees tab: full active roster ──
  const employees = await loadActiveEmployeeRows();

  const dateRange =
    job.endDate && job.endDate !== job.requestDate
      ? `${job.requestDate} – ${job.endDate}`
      : job.requestDate;

  const active = source === "quote" ? await resolveActiveQuoteForJob(jobRequestId) : null;

  return {
    job,
    source,
    // Real quote number when one exists; undefined on drafts (the Job Info tab
    // then shows the AES job number instead of the opaque quote row id).
    quoteDisplayCode: active?.quoteNo ?? undefined,
    quoteId: active?.id,
    dateRange,
    slots,
    employees,
    roles,
    reconciliation,
  };
}

/** Active employee roster for the Employees tab (and import matching). */
export async function loadActiveEmployeeRows(): Promise<RosterEmployeeRow[]> {
  const PAGE = 1000;
  const out: RosterEmployeeRow[] = [];
  let start = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { data, error } = await supabase
      .from("employees")
      .select("employee_key, full_name, first_name, last_name, phone, email, address, city, state, state_code, zip")
      .eq("is_deleted", false)
      .order("full_name")
      .range(start, start + PAGE - 1);
    if (error) throw error;
    const rows = data ?? [];
    for (const r of rows) {
      out.push({
        employeeKey: r.employee_key,
        fullName: r.full_name ?? "",
        first: r.first_name ?? "",
        last: r.last_name ?? "",
        phone: r.phone ?? "",
        email: r.email ?? "",
        address: r.address ?? "",
        city: r.city ?? "",
        state: r.state_code || r.state || "",
        zip: r.zip ?? "",
      });
    }
    if (rows.length < PAGE) break;
    start += PAGE;
    if (start > 50000) break;
  }
  return out;
}

// ─── Workbook writing ──────────────────────────────────────────────────────────

/** Build an ExcelJS workbook from gathered data. `exportedAtISO` is passed in
 *  (Date.now is unavailable in some runtimes; the caller stamps it). */
export async function writeRosterWorkbook(data: RosterData, exportedAtISO: string): Promise<any> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "Amplified AOS";

  // ── Job Info ──
  const info = wb.addWorksheet(SHEET.jobInfo);
  info.columns = [{ width: 22 }, { width: 60 }];
  const infoRow = (label: string, value: string) => info.addRow([label, value]);
  info.addRow(["JOB ROSTER — fill the Employee column on the Crew tab"]).font = { bold: true, size: 14 };
  info.addRow([]);
  infoRow("Job No", data.job.jobNo ?? "");
  infoRow("Event", data.job.eventName);
  infoRow("Client", data.job.client);
  infoRow("Venue", data.job.venue);
  infoRow("Location", [data.job.city, data.job.state].filter(Boolean).join(", "));
  infoRow("Dates", data.dateRange);
  infoRow("Times", [data.job.startTime, data.job.endTime].filter(Boolean).join(" – "));
  infoRow("Template source", data.source === "quote"
    ? `Quote — ${data.quoteDisplayCode || data.job.jobNo || ""}`.trim()
    : "Job requirements");
  infoRow("Exported", exportedAtISO);
  info.addRow([]);
  const reconHdr = info.addRow(["Needed vs assigned (by role)"]);
  reconHdr.font = { bold: true };
  info.addRow(["Role", "Needed", "Assigned", "Note"]).font = { bold: true };
  for (const r of data.reconciliation) {
    const note = r.delta > 0 ? `${r.delta} over` : r.delta < 0 ? `${-r.delta} unfilled` : "OK";
    info.addRow([r.role, r.needed, r.assigned, note]);
  }

  // ── Valid Roles (write before Crew so validation can reference it) ──
  // data.roles is sorted by position then specialty, so each position's
  // specialties are contiguous — required by the cascading specialty list.
  const roles = wb.addWorksheet(SHEET.validRoles);
  roles.addRow(ROLE_HEADERS).font = { bold: true };
  const distinctPositions: string[] = [];
  for (const r of data.roles) {
    roles.addRow([r.positionName, r.specialtyName, r.specialtyId]);
    if (r.positionName && !distinctPositions.includes(r.positionName)) distinctPositions.push(r.positionName);
  }
  // Distinct positions into the hidden positionList column (source for the
  // Position dropdown). Written down column D independent of the A/B rows.
  distinctPositions.forEach((p, i) => { roles.getCell(i + 2, ROLE_COL.positionList).value = p; });
  roles.getColumn(ROLE_COL.specialtyId).hidden = true;
  roles.getColumn(ROLE_COL.positionList).hidden = true;
  roles.getColumn(ROLE_COL.position).width = 22;
  roles.getColumn(ROLE_COL.specialty).width = 22;

  const lastRoleRow = data.roles.length + 1;        // header + role rows
  const lastPosRow = distinctPositions.length + 1;  // header + distinct positions

  // ── Employees ──
  const emps = wb.addWorksheet(SHEET.employees);
  emps.addRow(EMP_HEADERS).font = { bold: true };
  for (const e of data.employees) {
    emps.addRow([e.fullName, e.first, e.last, e.phone, e.email, e.address, e.city, e.state, e.zip, e.employeeKey]);
  }
  emps.getColumn(EMP_COL.employeeKey).hidden = true;
  [22, 14, 14, 16, 26, 28, 16, 8, 10].forEach((w, i) => { emps.getColumn(i + 1).width = w; });

  // ── Crew ── (Position before Specialty per request)
  const crew = wb.addWorksheet(SHEET.crew);
  crew.addRow(CREW_HEADERS).font = { bold: true };
  for (const s of data.slots) {
    crew.addRow([
      s.eventDate, s.day, s.shiftLabel, s.call, s.start, s.end,
      s.positionName, s.specialtyName, s.employeeName, s.confirmed ? CONFIRMED_YES : CONFIRMED_NO, s.notes, s.status,
      s.dayId, s.shiftId, s.specialtyId, s.positionId, s.assignmentId,
    ]);
  }
  // Hide binding id columns.
  for (let c = CREW_FIRST_HIDDEN_COL; c <= CREW_HEADERS.length; c++) crew.getColumn(c).hidden = true;
  [12, 6, 12, 8, 8, 8, 18, 20, 24, 11, 24, 30].forEach((w, i) => { crew.getColumn(i + 1).width = w; });

  // Validation only across the populated range + a buffer for extra rows —
  // keeps the file lean and the cascade formulas bounded.
  const posCol = colLetter(CREW_COL.position);
  const lastDataRow = Math.max(data.slots.length + 1 + 100, 200);
  for (let r = 2; r <= lastDataRow; r++) {
    // Position: pick from the distinct-positions list.
    crew.getCell(r, CREW_COL.position).dataValidation = {
      type: "list", allowBlank: true,
      formulae: [`'${SHEET.validRoles}'!$D$2:$D$${lastPosRow}`],
    };
    // Specialty: cascades from the row's Position — the contiguous block of
    // specialties for that position (Valid Roles is sorted by position).
    crew.getCell(r, CREW_COL.specialty).dataValidation = {
      type: "list", allowBlank: true,
      formulae: [
        `OFFSET('${SHEET.validRoles}'!$B$2,` +
          `MATCH($${posCol}${r},'${SHEET.validRoles}'!$A$2:$A$${lastRoleRow},0)-1,0,` +
          `COUNTIF('${SHEET.validRoles}'!$A$2:$A$${lastRoleRow},$${posCol}${r}),1)`,
      ],
    };
    crew.getCell(r, CREW_COL.employee).dataValidation = {
      type: "list", allowBlank: true,
      formulae: [`${SHEET.employees}!$A$2:$A$${MAX_LIST_ROWS}`],
    };
    crew.getCell(r, CREW_COL.confirmed).dataValidation = {
      type: "list", allowBlank: true, formulae: [`"${CONFIRMED_YES},${CONFIRMED_NO}"`],
    };
  }

  // ── Meta (very hidden machine stamp) ──
  const meta: RosterMeta = {
    schemaVersion: ROSTER_SCHEMA_VERSION,
    jobRequestId: data.job.id,
    jobNo: data.job.jobNo ?? "",
    eventName: data.job.eventName,
    source: data.source,
    quoteId: data.quoteId,
    quoteDisplayCode: data.source === "quote" ? (data.quoteDisplayCode || data.job.jobNo) : undefined,
    exportedAt: exportedAtISO,
  };
  const metaSheet = wb.addWorksheet(SHEET.meta);
  metaSheet.getCell("A1").value = JSON.stringify(meta);
  metaSheet.state = "veryHidden";

  return wb;
}

/** High-level: gather + write, return a Blob ready to download. */
export async function buildRosterWorkbookBlob(
  jobRequestId: string,
  source: RosterSource,
  exportedAtISO: string,
): Promise<{ blob: Blob; filename: string }> {
  const data = await gatherRoster(jobRequestId, source);
  const wb = await writeRosterWorkbook(data, exportedAtISO);
  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const safe = (data.job.jobNo || data.job.eventName || "roster").replace(/[^\w.-]+/g, "_");
  return { blob, filename: `crew-roster_${safe}.xlsx` };
}
