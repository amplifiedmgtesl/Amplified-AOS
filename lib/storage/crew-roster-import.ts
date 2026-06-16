/**
 * Crew-roster spreadsheet — IMPORT side.
 *
 * Reads back a workbook produced by crew-roster-export.ts and reconciles it
 * onto a job:
 *   Step 0  job-identity guard (stamp must match the job on screen)
 *   Step A  employees-first — name-match existing or create new (min: a name)
 *   Step B  assignment upsert/delete diff against current assignments
 *   Step C  re-export with per-row Status notes as the fix loop
 *
 * See docs/crew-roster-spreadsheet-spec.md.
 */

import { supabase } from "@/lib/supabase/client";
import {
  loadAssignmentsForRequest,
  upsertAssignment,
  deleteAssignment,
} from "./job-request-assignments";
import { loadJobRequestDays } from "./job-request-days";
import { loadShifts } from "./job-request-shifts";
import {
  gatherRoster,
  writeRosterWorkbook,
  loadActiveEmployeeRows,
  type RosterEmployeeRow,
} from "./crew-roster-export";
import {
  SHEET,
  CREW_COL,
  EMP_COL,
  ROLE_COL,
  CONFIRMED_YES,
  type RosterMeta,
  type RosterSource,
} from "./crew-roster-schema";
import type { JobRequestAssignment } from "@/lib/store/types";

// ─── Parsed shapes ─────────────────────────────────────────────────────────────

export type ParsedEmployeeRow = {
  rowNumber: number;
  fullName: string;
  first: string;
  last: string;
  phone: string;
  email: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  employeeKey: string; // "" => coordinator-added (new)
};

export type ParsedCrewRow = {
  rowNumber: number;
  eventDate: string;   // visible Date column, normalized YYYY-MM-DD — authoritative for day binding
  shiftLabel: string;  // visible Shift column — authoritative for shift binding
  positionName: string;
  specialtyName: string;
  employeeName: string;
  confirmed: boolean;
  notes: string;
  dayId: string;
  shiftId: string;
  specialtyId: string;
  positionId: string;
  assignmentId: string;
};

export type ParsedRoster = {
  meta: RosterMeta;
  crew: ParsedCrewRow[];
  employees: ParsedEmployeeRow[];
  /** "position||specialty" (lower) -> specialtyId — disambiguates specialty
   *  names that repeat across positions. */
  roleByPosSpec: Map<string, string>;
  /** specialtyName (lower) -> specialtyId — fallback when position is blank. */
  roleSpecByName: Map<string, string>;
};

// ─── Cell helpers ──────────────────────────────────────────────────────────────

function cellStr(ws: any, row: number, col: number): string {
  const c = ws.getCell(row, col);
  const v = c?.value;
  if (v == null) return "";
  if (typeof v === "object") {
    // rich text / formula result / hyperlink object
    if ("result" in v) return String((v as any).result ?? "");
    if ("text" in v) return String((v as any).text ?? "");
    if ("richText" in v) return (v as any).richText.map((t: any) => t.text).join("");
    return String(c.text ?? "");
  }
  return String(v);
}

/** Read a date cell as YYYY-MM-DD regardless of whether Excel kept it as text
 *  or coerced it to a real date (e.g. after the coordinator copied the row). */
function cellDate(ws: any, row: number, col: number): string {
  const v = ws.getCell(row, col)?.value;
  if (v == null) return "";
  const norm = (x: any): string => {
    if (x instanceof Date) {
      return `${x.getUTCFullYear()}-${String(x.getUTCMonth() + 1).padStart(2, "0")}-${String(x.getUTCDate()).padStart(2, "0")}`;
    }
    const s = String(x).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
    return s;
  };
  if (typeof v === "object" && !(v instanceof Date) && "result" in v) return norm((v as any).result);
  return norm(v);
}

// ─── Parse ───────────────────────────────────────────────────────────────────

export async function parseRosterWorkbook(buffer: ArrayBuffer): Promise<ParsedRoster> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);

  const metaSheet = wb.getWorksheet(SHEET.meta);
  if (!metaSheet) {
    throw new Error("This file isn't a roster workbook (missing job stamp). Export a fresh template and use that.");
  }
  let meta: RosterMeta;
  try {
    meta = JSON.parse(cellStr(metaSheet, 1, 1));
  } catch {
    throw new Error("Roster job stamp is corrupt. Export a fresh template.");
  }

  const crewWs = wb.getWorksheet(SHEET.crew);
  const empWs = wb.getWorksheet(SHEET.employees);
  const roleWs = wb.getWorksheet(SHEET.validRoles);
  if (!crewWs || !empWs) throw new Error("Roster workbook is missing the Crew or Employees tab.");

  const roleByPosSpec = new Map<string, string>();
  const roleSpecByName = new Map<string, string>();
  if (roleWs) {
    roleWs.eachRow((row: any, n: number) => {
      if (n === 1) return;
      const pos = cellStr(roleWs, n, ROLE_COL.position).trim();
      const name = cellStr(roleWs, n, ROLE_COL.specialty).trim();
      const id = cellStr(roleWs, n, ROLE_COL.specialtyId).trim();
      if (name && id) {
        roleSpecByName.set(name.toLowerCase(), id);
        roleByPosSpec.set(`${pos.toLowerCase()}||${name.toLowerCase()}`, id);
      }
    });
  }

  const employees: ParsedEmployeeRow[] = [];
  empWs.eachRow((row: any, n: number) => {
    if (n === 1) return;
    const first = cellStr(empWs, n, EMP_COL.first).trim();
    const last = cellStr(empWs, n, EMP_COL.last).trim();
    // Full Name is what the Crew dropdown shows, but tolerate a coordinator who
    // filled only First/Last — derive the name so the row still imports.
    const fullName = cellStr(empWs, n, EMP_COL.fullName).trim() || [first, last].filter(Boolean).join(" ");
    if (!fullName) return;
    employees.push({
      rowNumber: n,
      fullName,
      first,
      last,
      phone: cellStr(empWs, n, EMP_COL.phone).trim(),
      email: cellStr(empWs, n, EMP_COL.email).trim(),
      address: cellStr(empWs, n, EMP_COL.address).trim(),
      city: cellStr(empWs, n, EMP_COL.city).trim(),
      state: cellStr(empWs, n, EMP_COL.state).trim(),
      zip: cellStr(empWs, n, EMP_COL.zip).trim(),
      employeeKey: cellStr(empWs, n, EMP_COL.employeeKey).trim(),
    });
  });

  const crew: ParsedCrewRow[] = [];
  crewWs.eachRow((row: any, n: number) => {
    if (n === 1) return;
    crew.push({
      rowNumber: n,
      eventDate: cellDate(crewWs, n, CREW_COL.date),
      shiftLabel: cellStr(crewWs, n, CREW_COL.shift).trim(),
      positionName: cellStr(crewWs, n, CREW_COL.position).trim(),
      specialtyName: cellStr(crewWs, n, CREW_COL.specialty).trim(),
      employeeName: cellStr(crewWs, n, CREW_COL.employee).trim(),
      confirmed: cellStr(crewWs, n, CREW_COL.confirmed).trim().toLowerCase() === CONFIRMED_YES.toLowerCase(),
      notes: cellStr(crewWs, n, CREW_COL.notes).trim(),
      dayId: cellStr(crewWs, n, CREW_COL.dayId).trim(),
      shiftId: cellStr(crewWs, n, CREW_COL.shiftId).trim(),
      specialtyId: cellStr(crewWs, n, CREW_COL.specialtyId).trim(),
      positionId: cellStr(crewWs, n, CREW_COL.positionId).trim(),
      assignmentId: cellStr(crewWs, n, CREW_COL.assignmentId).trim(),
    });
  });

  return { meta, crew, employees, roleByPosSpec, roleSpecByName };
}

// ─── Name matching (deliberately name-based; phone/email too dirty to require) ──

function normName(s: string): string {
  return s.toLowerCase().trim().replace(/\s+/g, " ");
}

function scoreName(query: string, full: string): number {
  const tokens = normName(query).split(" ").filter(Boolean);
  const fl = full.toLowerCase();
  const words = fl.split(/\s+/);
  let total = 0;
  for (const t of tokens) {
    let s = 0;
    if (words.some((w) => w.startsWith(t))) s = 100;
    else if (fl.includes(t)) s = 50;
    if (s === 0) return 0;
    total += s;
  }
  return total;
}

export type EmployeeCandidate = {
  employeeKey: string;
  fullName: string;
  phone: string;
  email: string;
  city: string;
  state: string;
};

export type EmployeeMatch = {
  parsed: ParsedEmployeeRow;
  candidates: EmployeeCandidate[];
};

export type EmployeeReconcilePlan = {
  /** new rows with no plausible existing match — created automatically */
  autoCreate: ParsedEmployeeRow[];
  /** new rows that resemble existing people — coordinator chooses link vs create */
  ambiguous: EmployeeMatch[];
};

/** Plan employee reconciliation for the new (blank-key) Employees-tab rows.
 *  Bias toward *asking*: any plausible name match → ambiguous (prompt the
 *  coordinator); only truly-novel names auto-create. */
export async function planEmployeeReconciliation(
  parsed: ParsedRoster,
  existing?: RosterEmployeeRow[],
): Promise<EmployeeReconcilePlan> {
  const roster = existing ?? (await loadActiveEmployeeRows());
  const autoCreate: ParsedEmployeeRow[] = [];
  const ambiguous: EmployeeMatch[] = [];

  for (const row of parsed.employees) {
    if (row.employeeKey) continue; // already an existing person
    const scored = roster
      .map((e) => ({ e, score: scoreName(row.fullName, e.fullName) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);
    if (scored.length === 0) {
      autoCreate.push(row);
    } else {
      ambiguous.push({
        parsed: row,
        candidates: scored.map((x) => ({
          employeeKey: x.e.employeeKey,
          fullName: x.e.fullName,
          phone: x.e.phone,
          email: x.e.email,
          city: x.e.city,
          state: x.e.state,
        })),
      });
    }
  }
  return { autoCreate, ambiguous };
}

// ─── Commit ────────────────────────────────────────────────────────────────────

export type EmployeeDecision = { action: "create" | "link"; linkKey?: string };

export type ImportResult = {
  employeesCreated: number;
  employeesLinked: number;
  assignmentsUpserted: number;
  assignmentsDeleted: number;
  skipped: { rowNumber: number; employeeName: string; reason: string }[];
};

function newAssignmentId(): string {
  return `jra-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
function newEmployeeKey(i: number): string {
  return `emp-${Date.now().toString(36)}-${i}`;
}

/**
 * Commit a parsed roster onto a job.
 *
 * @param decisions  keyed by normalized full-name, for the ambiguous rows from
 *                   planEmployeeReconciliation. autoCreate rows are always
 *                   created. Rows with an existing employeeKey are linked as-is.
 */
export async function commitRosterImport(
  jobRequestId: string,
  parsed: ParsedRoster,
  decisions: Map<string, EmployeeDecision>,
  todayISO: string,
): Promise<ImportResult> {
  // ── Step 0: job-identity guard ──
  if (parsed.meta.jobRequestId !== jobRequestId) {
    throw new Error(
      `This sheet was exported for Job ${parsed.meta.jobNo || parsed.meta.jobRequestId} (${parsed.meta.eventName}). ` +
        `You're uploading to a different job. Open the right job or export a fresh template.`,
    );
  }

  const result: ImportResult = {
    employeesCreated: 0,
    employeesLinked: 0,
    assignmentsUpserted: 0,
    assignmentsDeleted: 0,
    skipped: [],
  };

  // ── Step A: resolve employees (name → employee_key) ──
  const keyByName = new Map<string, string>(); // normName -> employee_key
  const toCreate: { record: any; name: string }[] = [];
  let createIdx = 0;

  for (const row of parsed.employees) {
    const nkey = normName(row.fullName);
    if (row.employeeKey) {
      keyByName.set(nkey, row.employeeKey);
      continue;
    }
    const decision = decisions.get(nkey);
    if (decision?.action === "link" && decision.linkKey) {
      keyByName.set(nkey, decision.linkKey);
      result.employeesLinked++;
      continue;
    }
    // create (explicit decision, or auto for novel names with no decision)
    const employeeKey = newEmployeeKey(createIdx++);
    keyByName.set(nkey, employeeKey);
    toCreate.push({
      name: row.fullName,
      record: {
        employee_key: employeeKey,
        full_name: row.fullName,
        first_name: row.first || row.fullName.split(/\s+/)[0] || "",
        last_name: row.last || row.fullName.split(/\s+/).slice(1).join(" ") || "",
        phone: row.phone || null,
        email: row.email || null,
        address: row.address || null,
        city: row.city || null,
        state_code: row.state || null,
        zip: row.zip || null,
        type: "contractor",
        source: "roster-import",
        hire_date: todayISO,
        is_deleted: false,
      },
    });
  }

  if (toCreate.length > 0) {
    const { error } = await supabase.from("employees").insert(toCreate.map((t) => t.record));
    if (error) throw new Error(`Failed to create new employees: ${error.message}`);
    result.employeesCreated = toCreate.length;
  }

  // ── Step B: build desired assignments + diff ──
  // Binding is driven by the VISIBLE columns (Date, Shift, Position/Specialty),
  // not the hidden ids — so a coordinator can copy a row to other days (Excel
  // copies the hidden cells too) and it still binds to the day the row shows.
  // Hidden ids are only a fallback when the visible value can't be resolved.
  const jobDays = await loadJobRequestDays(jobRequestId);
  const jobDayIds = new Set(jobDays.map((d) => d.id));
  const dayByDate = new Map(jobDays.map((d) => [d.eventDate, d.id]));
  const shifts = await loadShifts(jobRequestId);
  const shiftByLabel = new Map(shifts.map((s) => [s.label.toLowerCase(), s.id]));

  // specialty -> position lookup for derivation + validation
  const spcRes = await supabase.from("specialties").select("id, position_id");
  if (spcRes.error) throw spcRes.error;
  const posBySpecialty = new Map<string, string>();
  for (const s of spcRes.data ?? []) posBySpecialty.set(s.id, s.position_id);

  const existing = await loadAssignmentsForRequest(jobRequestId);
  const existingBySig = new Map<string, JobRequestAssignment>();
  for (const a of existing) existingBySig.set(`${a.jobRequestDayId}::${a.shiftId || ""}::${a.employeeKey || ""}`, a);

  const desired: JobRequestAssignment[] = [];
  const desiredSig = new Set<string>(); // dayId|shift|employeeKey — dedupe + keep-detection
  let sortOrder = 0;

  for (const r of parsed.crew) {
    if (!r.employeeName) continue; // unfilled slot — nothing to create
    const employeeKey = keyByName.get(normName(r.employeeName));
    if (!employeeKey) {
      result.skipped.push({ rowNumber: r.rowNumber, employeeName: r.employeeName, reason: "employee not found on the Employees tab" });
      continue;
    }
    // Day: visible Date first (copy-paste safe), hidden day_id as fallback.
    const dayId = (r.eventDate && dayByDate.get(r.eventDate)) || (jobDayIds.has(r.dayId) ? r.dayId : "");
    if (!dayId) {
      result.skipped.push({ rowNumber: r.rowNumber, employeeName: r.employeeName, reason: "row's date is not a day on this job" });
      continue;
    }
    // Shift: visible label first, hidden shift_id only when no label is shown.
    let shiftId = "";
    if (r.shiftLabel) shiftId = shiftByLabel.get(r.shiftLabel.toLowerCase()) ?? "";
    else if (r.shiftId) shiftId = r.shiftId;
    // Specialty: visible (position,specialty) pair first, then specialty name,
    // then hidden id — so changing the dropdown on a copied row wins.
    let specialtyId =
      parsed.roleByPosSpec.get(`${r.positionName.toLowerCase()}||${r.specialtyName.toLowerCase()}`) ||
      (r.specialtyName ? parsed.roleSpecByName.get(r.specialtyName.toLowerCase()) : "") ||
      r.specialtyId ||
      "";
    if (specialtyId && !posBySpecialty.has(specialtyId)) specialtyId = ""; // stale id
    if (!specialtyId) {
      result.skipped.push({ rowNumber: r.rowNumber, employeeName: r.employeeName, reason: `"${r.specialtyName || "(blank)"}" is not a valid role` });
      continue;
    }
    const positionId = posBySpecialty.get(specialtyId) ?? "";
    const sig = `${dayId}::${shiftId || ""}::${employeeKey}`;
    if (desiredSig.has(sig)) {
      result.skipped.push({ rowNumber: r.rowNumber, employeeName: r.employeeName, reason: "duplicate (same day, shift, employee)" });
      continue;
    }
    desiredSig.add(sig);
    // Reuse the existing assignment's id when one already covers this slot
    // (idempotent update); otherwise mint a fresh id. The hidden assignment_id
    // is intentionally NOT trusted — a copied row carries a stale one.
    const id = existingBySig.get(sig)?.id || newAssignmentId();
    desired.push({
      id,
      jobRequestDayId: dayId,
      employeeKey,
      positionId: positionId || undefined,
      specialtyId,
      shiftId: shiftId || undefined,
      confirmed: r.confirmed,
      notes: r.notes || undefined,
      sortOrder: sortOrder++,
    });
  }

  // Existing assignments not present in the sheet (by slot signature) → delete.
  for (const a of existing) {
    const sig = `${a.jobRequestDayId}::${a.shiftId || ""}::${a.employeeKey || ""}`;
    if (!desiredSig.has(sig)) {
      await deleteAssignment(a.id);
      result.assignmentsDeleted++;
    }
  }

  for (const a of desired) {
    await upsertAssignment(a);
    result.assignmentsUpserted++;
  }

  return result;
}

// ─── Step C: re-export the fix-loop workbook ───────────────────────────────────

/** Build the post-import workbook: fresh committed state + any skipped rows
 *  appended with their reason in the Status column. */
export async function buildReexportBlob(
  jobRequestId: string,
  source: RosterSource,
  exportedAtISO: string,
  skipped: ImportResult["skipped"],
): Promise<{ blob: Blob; filename: string }> {
  const data = await gatherRoster(jobRequestId, source);
  // Append skipped rows so the coordinator can see + fix them.
  for (const s of skipped) {
    data.slots.push({
      eventDate: "", day: "", shiftLabel: "", call: "", start: "", end: "",
      specialtyName: "", positionName: "", employeeName: s.employeeName,
      confirmed: false, notes: "", status: `⚠ skipped — ${s.reason}`,
      dayId: "", shiftId: "", specialtyId: "", positionId: "", assignmentId: "",
    });
  }
  const wb = await writeRosterWorkbook(data, exportedAtISO);
  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const safe = (data.job.jobNo || data.job.eventName || "roster").replace(/[^\w.-]+/g, "_");
  return { blob, filename: `crew-roster_${safe}_reviewed.xlsx` };
}
