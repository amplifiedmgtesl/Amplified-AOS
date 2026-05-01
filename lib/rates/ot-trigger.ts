import type { TriggerOption } from "./defaults";

export type OtTriggerKind =
  | { kind: "none" }
  | { kind: "weekly" }
  | { kind: "daily"; hours: number };

export function formatOtTriggerRule(value: TriggerOption): string {
  if (value === "none") return "No OT";
  if (value === "weekly40") return "OT after 40 / week";
  return `OT after ${value} / DT after 15`;
}

export function triggerLabel(value: TriggerOption): string {
  if (value === "none") return "No OT (flat)";
  if (value === "weekly40") return "OT after 40 / week";
  return `OT after ${value} / DT after 15`;
}

export function triggerToKind(value: TriggerOption): OtTriggerKind {
  if (value === "none") return { kind: "none" };
  if (value === "weekly40") return { kind: "weekly" };
  return { kind: "daily", hours: Number(value) };
}

export function parseOtTriggerRule(rule: string): OtTriggerKind {
  const r = rule || "";
  if (/no\s*ot/i.test(r)) return { kind: "none" };
  if (/OT after\s+40\s*\/?\s*week/i.test(r)) return { kind: "weekly" };
  const m = r.match(/OT after\s+(\d+(?:\.\d+)?)/i);
  if (m) return { kind: "daily", hours: Number(m[1]) };
  return { kind: "daily", hours: 10 };
}

export function formatOtTriggerKind(kind: OtTriggerKind): string {
  if (kind.kind === "none") return "No OT";
  if (kind.kind === "weekly") return "OT after 40 / week";
  return `OT after ${kind.hours} / DT after 15`;
}

export function computeDayHourSplit(
  totalHours: number,
  trigger: OtTriggerKind,
): { st: number; ot: number; dt: number } {
  const hrs = Math.max(0, totalHours);
  if (trigger.kind === "none" || trigger.kind === "weekly") {
    return { st: hrs, ot: 0, dt: 0 };
  }
  const otStart = trigger.hours;
  const ot = Math.max(0, Math.min(hrs, 15) - otStart);
  const dt = Math.max(0, hrs - 15);
  const st = Math.min(hrs, otStart);
  return { st, ot, dt };
}
