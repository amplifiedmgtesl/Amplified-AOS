export type TriggerOption = "10" | "11" | "12" | "13" | "14" | "15";
export type RateRow = {
  group: string;
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
const makeRow = (group:string, position:string, specialty:string, hourly:number, day:number): RateRow => ({
  group, position, specialty, hourly, day,
  otRate: Number((hourly * 1.5).toFixed(2)),
  dtRate: Number((hourly * 2.0).toFixed(2)),
  dtAfter: "10",
  travel: 0,
  show: true
});
export const DEFAULT_RATE_ROWS: RateRow[] = [
  makeRow("Stagehand","Stagehand","Labor",35,350), makeRow("Stagehand","Stagehand","Show Call",35,350),
  makeRow("Stagehand","Stagehand","AVL",35,350), makeRow("Stagehand","Stagehand","Stage",35,350),
  makeRow("Stagehand","Stagehand","Scaffolding",35,350), makeRow("Stagehand","Stagehand","Loader",35,350),
  makeRow("Rigger","Rigger","Climber",50,500), makeRow("Rigger","Rigger","Operator",50,500),
  makeRow("Rigger","Rigger","Up",50,500), makeRow("Rigger","Rigger","Down",50,500),
  makeRow("Rigger 1","Rigger 1","Head Rigger",65,650), makeRow("Rigger 1","Rigger 1","High Steel",65,650),
  makeRow("Rigger 1","Rigger 1","Rope Access",65,650),
  makeRow("Fork Op","Fork Op","Shop",38,380), makeRow("Fork Op","Fork Op","Telendler",38,380), makeRow("Fork Op","Fork Op","Large Fork Options",38,380),
  makeRow("Audio Technician","Audio Technician","A1",60,600), makeRow("Audio Technician","Audio Technician","A2",50,500),
  makeRow("Lighting Technician","Lighting Technician","L1",60,600), makeRow("Lighting Technician","Lighting Technician","L2",50,500),
  makeRow("Video Technician","Video Technician","V1",60,600), makeRow("Video Technician","Video Technician","V2",50,500),
  makeRow("Camera Op","Camera Op","Tripod",50,500), makeRow("Camera Op","Camera Op","Mobile",50,500),
  makeRow("Operations","Operations","Prod. Runner",34,340), makeRow("Operations","Operations","Prod. Assist",34,340), makeRow("Operations","Operations","Services",34,340),
  makeRow("Operations","Operations","Steward",34,340), makeRow("Operations","Operations","Crew Chief",42,420),
];
export const DEFAULT_TERMS = `Billing Structure:
All positions are billed at a five (5) hour minimum per shift.
Day rates are based on ten (10) hour shifts.

OT may be triggered after ten (10), eleven (11), twelve (12), thirteen (13), fourteen (14), or fifteen (15) hours, based on the selected position structure.
DT is billed only after fifteen (15) hours.

Travel may be added per position as quoted.

Overtime is billed at 1.5 times the regular hourly rate after 40 worked hours in a contiguous work week. The standard work week runs Sunday through Saturday.

Holiday hours are billed at 2.0 times the regular hourly rate. Recognized holidays include Christmas Eve, Christmas Day, New Year's Eve, New Year's Day, Easter, Memorial Day, Independence Day, and Thanksgiving Day.`;
