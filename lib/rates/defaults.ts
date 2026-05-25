export type TriggerOption = "none" | "10" | "11" | "12" | "13" | "14" | "15" | "weekly40";

export type RateCardProfile = {
  id: string;
  clientId?: string;   // FK to clients table
  clientName: string;  // kept for fallback/display compat
  name: string;        // descriptive name e.g. "Standard", "Union", "Weekend"
  effectiveDate?: string; // ISO date (YYYY-MM-DD); rate card applies on/after this date
  rows: RateRow[];
  terms: string;
  /** Multiplier applied to all billable hours on days flagged is_holiday.
   *  Defaults to 2.0; per-rate-card configurable. Quotes / invoices snapshot
   *  this value on creation so frozen docs preserve their issued rate. */
  holidayMultiplier: number;
  createdAt: string;
  updatedAt: string;
};
export type RateRow = {
  specialtyId?: string;  // FK → specialties(id); undefined for legacy/working-state rows
  department: string;    // derived = position name; kept for backward compat
  position: string;
  specialty: string;
  hourly: number;
  day: number;
  otRate: number;
  dtRate: number;
  dtAfter: TriggerOption;
  travel: number;
  show: boolean;
};
const makeRow = (specialtyId: string, position: string, specialty: string, hourly: number, day: number): RateRow => ({
  specialtyId, department: position, position, specialty, hourly, day,
  otRate: Number((hourly * 1.5).toFixed(2)),
  dtRate: Number((hourly * 2.0).toFixed(2)),
  dtAfter: "10",
  travel: 0,
  show: true
});
export const DEFAULT_RATE_ROWS: RateRow[] = [
  makeRow("spc-01-01","Stagehand","Labor",35,350),
  makeRow("spc-01-02","Stagehand","Show Call",35,350),
  makeRow("spc-01-03","Stagehand","AVL",35,350),
  makeRow("spc-01-04","Stagehand","Stage",35,350),
  makeRow("spc-01-05","Stagehand","Scaffolding",35,350),
  makeRow("spc-01-06","Stagehand","Loader",35,350),
  makeRow("spc-03-01","Rigger","Climber",50,500),
  makeRow("spc-03-02","Rigger","Operator",50,500),
  makeRow("spc-03-03","Rigger","Up",50,500),
  makeRow("spc-03-04","Rigger","Down",50,500),
  makeRow("spc-04-01","Head Rigger","Head Rigger",65,650),
  makeRow("spc-04-02","Head Rigger","High Steel",65,650),
  makeRow("spc-04-03","Head Rigger","Rope Access",65,650),
  makeRow("spc-08-01","Forklift Operator","Shop",38,380),
  makeRow("spc-08-02","Forklift Operator","Telendler",38,380),
  makeRow("spc-08-03","Forklift Operator","Large Fork Options",38,380),
  makeRow("spc-05-01","Audio Technician","A1",60,600),
  makeRow("spc-05-02","Audio Technician","A2",50,500),
  makeRow("spc-06-01","Lighting Technician","L1",60,600),
  makeRow("spc-06-02","Lighting Technician","L2",50,500),
  makeRow("spc-07-01","Video Technician","V1",60,600),
  makeRow("spc-07-02","Video Technician","V2",50,500),
  makeRow("spc-09-01","Camera Operator","Tripod",50,500),
  makeRow("spc-09-02","Camera Operator","Mobile",50,500),
  makeRow("spc-10-01","Operations","Prod. Runner",34,340),
  makeRow("spc-10-02","Operations","Prod. Assist",34,340),
  makeRow("spc-10-03","Operations","Services",34,340),
  makeRow("spc-10-04","Operations","Steward",34,340),
  makeRow("spc-10-05","Operations","Crew Chief",42,420),
];
// DEFAULT_TERMS removed 2026-05-05 — terms now live in the master rate card
// profile (seeded by migration 20260504g) and per-client rate card profiles.
// New quote flow reads from rate_card_profiles.terms with empty-string fallback.
