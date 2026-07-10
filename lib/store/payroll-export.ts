// Payroll run → Rippling custom-earnings CSV import.
//
// Emits the wide per-employee template Rippling generates for its "Import a CSV
// in the pay run" flow (see docs/payroll-rippling-csv-export-spec.md). One row
// per employee; each employee's pay hours are bucketed into Rippling earning
// types (Rigger / Fork / Lead / Day Rate 1 / Climber / Coordinator …) by the
// position/specialty → earning-type mapping stored on the positions/specialties
// master tables.
//
// Resolution per entry:
//   specialty.ripplingEarningType   (override, when the entry has a specialty)
//   ?? position.ripplingEarningType  (position default)
//   ?? "Day Rate 1"                  (catch-all — anything unmapped pays here)
//
// Rate strategy (V1): emit HOURS only, leave Rate/Amount blank. Per Rippling
// docs, importing Hours alone makes Rippling apply the employee's stored
// per-earning-type rate — no drift risk from our snapshot, and it matches the
// CCMF upload that Rippling accepted. Empty cells = "no change" (never send
// 0.0000 for an unused earning type — that would zero out Rippling's default).

import type {
  PayrollRun,
  PayrollRunEntry,
  EmployeeRecord,
  Position,
  Specialty,
} from "./types";
import { RIPPLING_HEADERS } from "./rippling-headers";

const FALLBACK_EARNING_TYPE = "Day Rate 1";

function csvField(s: string | number): string {
  return `"${String(s).replace(/"/g, '""')}"`;
}
function hours(n: number): string {
  // 4-dp per the template; blank for zero so we never overwrite a Rippling default.
  return n > 0 ? n.toFixed(4) : "";
}

type Bucket = { std: number; ot: number; dt: number };
type EmpRow = {
  empNo: number | null;
  name: string;
  notes: Set<string>;
  byType: Map<string, Bucket>;
};

export function buildRipplingCsv(
  run: PayrollRun,
  entries: PayrollRunEntry[],
  employees: EmployeeRecord[],
  positions: Position[],
  specialties: Specialty[],
): string {
  // ── Lookups ──────────────────────────────────────────────────────────────
  const empNoByKey = new Map<string, number | null>();
  for (const e of employees) empNoByKey.set(e.employeeKey, e.ripplingEmployeeId ?? null);

  // position mapping is keyed by NAME — payroll_run_entries carries `position`
  // as text (no position_id).
  const earnByPositionName = new Map<string, string>();
  for (const p of positions) {
    if (p.ripplingEarningType) earnByPositionName.set(p.name, p.ripplingEarningType);
  }
  const earnBySpecialtyId = new Map<string, string>();
  for (const s of specialties) {
    if (s.ripplingEarningType) earnBySpecialtyId.set(s.id, s.ripplingEarningType);
  }

  function earningTypeFor(e: PayrollRunEntry): string {
    if (e.specialtyId) {
      const s = earnBySpecialtyId.get(e.specialtyId);
      if (s) return s;
    }
    if (e.position) {
      const p = earnByPositionName.get(e.position);
      if (p) return p;
    }
    return FALLBACK_EARNING_TYPE;
  }

  // ── Aggregate: one EmpRow per employee, hours bucketed by earning type ─────
  const rows = new Map<string, EmpRow>();
  for (const e of entries) {
    const key = e.employeeKey || `${e.firstName ?? ""} ${e.lastName ?? ""}`.trim() || e.email || "(unknown)";
    let r = rows.get(key);
    if (!r) {
      r = {
        empNo: e.employeeKey ? (empNoByKey.get(e.employeeKey) ?? null) : null,
        name: `${e.firstName ?? ""} ${e.lastName ?? ""}`.trim() || e.email || "(unknown)",
        notes: new Set(),
        byType: new Map(),
      };
      rows.set(key, r);
    }
    const et = earningTypeFor(e);
    let b = r.byType.get(et);
    if (!b) { b = { std: 0, ot: 0, dt: 0 }; r.byType.set(et, b); }
    b.std += e.payStdHours;
    b.ot += e.payOtHours;
    b.dt += e.payDtHours;

    // Paystub note carries the real AOS position/specialty the bucket hides,
    // plus any pay-adjustment reason, so the clerk (and the worker) can see it.
    const role = e.specialty ? `${e.position ?? ""}/${e.specialty}` : (e.position ?? "");
    if (role) r.notes.add(role);
    if (e.payAdjustmentReason) r.notes.add(e.payAdjustmentReason);
  }

  // ── Emit ───────────────────────────────────────────────────────────────────
  const lines: string[] = [RIPPLING_HEADERS.map(csvField).join(",")];

  const sorted = [...rows.values()]
    // Drop anyone with no pay hours at all — an all-blank row imports nothing
    // into Rippling and just clutters the clerk's review.
    .filter((r) => [...r.byType.values()].some((b) => b.std > 0 || b.ot > 0 || b.dt > 0))
    .sort((a, b) => a.name.localeCompare(b.name));
  for (const r of sorted) {
    const cell: Record<string, string> = {
      "Rippling Emp No": r.empNo != null ? String(r.empNo) : "",
      "Employee Name": r.name,
      "Paystub Note": [...r.notes].join("; "),
    };
    for (const [et, b] of r.byType) {
      if (b.std > 0) cell[`${et} Hours`] = hours(b.std);
      if (b.ot > 0) cell[`${et} overtime (1.5x base) Hours`] = hours(b.ot);
      if (b.dt > 0) cell[`${et} double overtime (2.0x base) Hours`] = hours(b.dt);
    }
    lines.push(RIPPLING_HEADERS.map((h) => csvField(cell[h] ?? "")).join(","));
  }

  return lines.join("\r\n") + "\r\n";
}

export function ripplingCsvFilename(run: PayrollRun): string {
  const short = run.id.slice(0, 6);
  return `amplified-payroll-${run.payDate}-${short}.csv`;
}
