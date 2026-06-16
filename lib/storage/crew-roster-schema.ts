/**
 * Shared layout contract for the crew-roster spreadsheet round-trip.
 *
 * Both crew-roster-export.ts (writes the workbook) and crew-roster-import.ts
 * (reads it back) import these constants so the two halves can never drift.
 *
 * Design spec: docs/crew-roster-spreadsheet-spec.md
 */

export const ROSTER_SCHEMA_VERSION = 1;

/** Sheet (tab) names. */
export const SHEET = {
  jobInfo: "Job Info",
  crew: "Crew",
  employees: "Employees",
  validRoles: "Valid Roles",
  /** very-hidden machine-stamp sheet — the import job-identity guard reads this */
  meta: "_meta",
} as const;

export type RosterSource = "requirements" | "quote";

/**
 * Crew tab columns, 1-based, in write order. Header row is row 1; data starts
 * row 2. Columns from `dayId` on are hidden — machine binding ids so re-import
 * never has to text-match.
 */
export const CREW_COL = {
  date: 1,        // the binding source of truth for the day (no day-of-week column — avoids editing one but not the other)
  shift: 2,
  call: 3,
  start: 4,
  end: 5,
  position: 6,    // dropdown-validated against the distinct positions list
  specialty: 7,   // dropdown cascades from the chosen position (valid pairs only)
  employee: 8,    // dropdown-validated against Employees; the one field they fill
  confirmed: 9,   // Yes/No
  notes: 10,
  status: 11,     // written on (re-)export; read-only guidance
  // hidden binding ids
  dayId: 12,
  shiftId: 13,
  specialtyId: 14,
  positionId: 15,
  assignmentId: 16,
} as const;

export const CREW_HEADERS = [
  "Date", "Shift", "Call", "Start", "End",
  "Position", "Specialty", "Employee", "Confirmed", "Notes", "Status",
  "day_id", "shift_id", "specialty_id", "position_id", "assignment_id",
];

export const CREW_FIRST_HIDDEN_COL = CREW_COL.dayId;

/** Employees tab columns, 1-based. `employeeKey` (last) is hidden. */
export const EMP_COL = {
  fullName: 1,
  first: 2,
  last: 3,
  phone: 4,
  email: 5,
  address: 6,
  city: 7,
  state: 8,
  zip: 9,
  employeeKey: 10, // hidden — blank on coordinator-added rows (import mints one)
} as const;

export const EMP_HEADERS = [
  "Full Name", "First", "Last", "Phone", "Email",
  "Address", "City", "State", "Zip", "employee_key",
];

/** Valid Roles tab columns, 1-based. NO rate columns — coordinators never see
 *  billing or pay figures anywhere in the workbook. */
export const ROLE_COL = {
  position: 1,    // sorted by position so each position's specialties are contiguous (cascade needs this)
  specialty: 2,
  specialtyId: 3, // hidden — authoritative id for (position,specialty) name→id resolution on import
  positionList: 4, // hidden — distinct positions; source for the Position dropdown
} as const;

export const ROLE_HEADERS = ["Position", "Specialty", "specialty_id", "Positions"];

/** Max data rows a validation list / formula range spans. Generous headroom. */
export const MAX_LIST_ROWS = 2000;

/** Machine stamp written to the _meta sheet (A1, JSON). The import guard
 *  compares `jobRequestId` against the screen's job before any write. */
export type RosterMeta = {
  schemaVersion: number;
  jobRequestId: string;
  jobNo: string;
  eventName: string;
  source: RosterSource;
  quoteId?: string;
  quoteDisplayCode?: string;
  exportedAt: string; // ISO; stamped by the caller (Date is unavailable in some sandboxes)
};

export const CONFIRMED_YES = "Yes";
export const CONFIRMED_NO = "No";
