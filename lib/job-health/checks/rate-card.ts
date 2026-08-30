// Rate-card integrity checks. These protect the quote, invoice, and payroll
// pipelines — most quote/invoice generation failures trace back here.

import type { CheckFn, Finding } from "../types";
import { deriveDayFloor, dayFloorIsExact } from "@/lib/rates/day-floor";

export const rateCardChecks: CheckFn[] = [
  // 1. A rate card resolves at all
  (ctx) => {
    if (ctx.rateCard) return [];
    return [{
      id: "rate_card.no_profile",
      severity: "blocker",
      category: "rate_card",
      title: "No rate card resolves for this job",
      detail: ctx.jobRequest.rateCardProfileId
        ? "The job has a pinned rate card override but the profile can't be loaded."
        : "No client-specific or master rate card covers this job's start date.",
      downstream: "Quote and invoice generation will fail. Timekeeping won't be able to look up bill rates.",
      fixHref: "/rate-card",
      fixLabel: "Open rate cards",
    }];
  },

  // 2. Rate card has the specialties the job needs
  (ctx) => {
    if (!ctx.rateCard) return [];
    const findings: Finding[] = [];
    const cardSpecialties = new Set(ctx.rateCard.rows.map((r) => r.specialtyId).filter(Boolean));
    const neededIds = new Set<string>();
    for (const n of ctx.crewNeeds) {
      if (n.specialtyId) neededIds.add(n.specialtyId);
    }
    const specMap = new Map(ctx.specialties.map((s) => [s.id, s.name] as const));
    for (const id of neededIds) {
      if (!cardSpecialties.has(id)) {
        const name = specMap.get(id) ?? id;
        findings.push({
          id: `rate_card.missing_specialty:${id}`,
          severity: "blocker",
          category: "rate_card",
          title: `Rate card missing specialty: ${name}`,
          detail: `Crew needs include ${name} but the resolved rate card has no row for it.`,
          downstream: "Quote lines for this role won't generate; invoice can't price actuals.",
          fixHref: "/rate-card",
          fixLabel: "Add row",
        });
      }
    }
    return findings;
  },

  // 3. Bill rates filled on rows used by this job
  (ctx) => {
    if (!ctx.rateCard) return [];
    const findings: Finding[] = [];
    const neededIds = new Set(ctx.crewNeeds.map((n) => n.specialtyId).filter(Boolean) as string[]);
    for (const row of ctx.rateCard.rows) {
      if (row.specialtyId && !neededIds.has(row.specialtyId)) continue;
      const missing: string[] = [];
      if (!row.hourly && !row.day) missing.push("bill rate (hourly or day)");
      if (!row.otRate) missing.push("OT bill rate");
      if (!row.dtRate) missing.push("DT bill rate");
      if (missing.length) {
        findings.push({
          id: `rate_card.missing_bill_rate:${row.specialtyId ?? row.specialty}`,
          severity: "blocker",
          category: "rate_card",
          title: `Missing bill rate: ${row.position} / ${row.specialty}`,
          detail: `Row is missing ${missing.join(", ")}.`,
          downstream: "Quote/invoice lines for this specialty will be $0 — the customer will be under-billed.",
          fixHref: "/rate-card",
          fixLabel: "Edit row",
        });
      }
    }
    return findings;
  },

  // 4. Pay rates filled on rows used by this job
  (ctx) => {
    if (!ctx.rateCard) return [];
    const findings: Finding[] = [];
    const neededIds = new Set(ctx.crewNeeds.map((n) => n.specialtyId).filter(Boolean) as string[]);
    for (const row of ctx.rateCard.rows) {
      if (row.specialtyId && !neededIds.has(row.specialtyId)) continue;
      const missing: string[] = [];
      if (!row.payHourly) missing.push("pay hourly");
      if (!row.payOtRate) missing.push("pay OT");
      if (!row.payDtRate) missing.push("pay DT");
      if (missing.length) {
        findings.push({
          id: `rate_card.missing_pay_rate:${row.specialtyId ?? row.specialty}`,
          severity: "warning",
          category: "rate_card",
          title: `Missing pay rate: ${row.position} / ${row.specialty}`,
          detail: `Row is missing ${missing.join(", ")}. Pay rates are admin-only — never printed on customer docs.`,
          downstream: "Payroll for this role will be $0 unless overridden per-employee. Finalize will be blocked.",
          fixHref: "/rate-card",
          fixLabel: "Edit row",
        });
      }
    }
    return findings;
  },

  // 5. OT/DT thresholds set
  (ctx) => {
    if (!ctx.rateCard) return [];
    const findings: Finding[] = [];
    const neededIds = new Set(ctx.crewNeeds.map((n) => n.specialtyId).filter(Boolean) as string[]);
    const noThreshold = new Set(["none", "", null, undefined]);
    for (const row of ctx.rateCard.rows) {
      if (row.specialtyId && !neededIds.has(row.specialtyId)) continue;
      if (noThreshold.has(row.otAfter as any) && noThreshold.has(row.dtAfter as any)) {
        findings.push({
          id: `rate_card.no_ot_threshold:${row.specialtyId ?? row.specialty}`,
          severity: "info",
          category: "rate_card",
          title: `No OT/DT threshold: ${row.position} / ${row.specialty}`,
          detail: "This row has no OT or DT trigger — all hours bill at straight time.",
          downstream: "Intentional for flat day-rate contracts. Otherwise OT/DT premium is silently dropped.",
          fixHref: "/rate-card",
          fixLabel: "Review row",
        });
      }
    }
    return findings;
  },

  // 6. Day-rate floor is derived, not stored — flag rows where the division
  //    doesn't come out even.
  //
  //    priceTimesheetGroup decides how many hours a day rate "covers" per
  //    worker as round(day / hourly); hours past that bill hourly as
  //    overflow. When the ratio is a whole number (350/35, 500/50) the floor
  //    is exactly what the contract says. When it isn't, the floor is a
  //    rounded value nobody chose — 440/43 = 10.23 rounds to 10, and
  //    400/37.50 = 10.67 rounds to 11, shifting where overflow starts.
  //
  //    Storing the floor explicitly is the real fix (backlog #36 option A);
  //    this check is option B — surface the ambiguity at the point someone
  //    can still correct the rate card.
  (ctx) => {
    if (!ctx.rateCard) return [];
    const findings: Finding[] = [];
    const neededIds = new Set(ctx.crewNeeds.map((n) => n.specialtyId).filter(Boolean) as string[]);
    for (const row of ctx.rateCard.rows) {
      if (row.specialtyId && !neededIds.has(row.specialtyId)) continue;
      const day = Number(row.day || 0);
      const hourly = Number(row.hourly || 0);
      if (day <= 0 || hourly <= 0) continue;          // not a day-rate row
      if (dayFloorIsExact(day, hourly)) continue;     // divides evenly — fine
      const ratio = day / hourly;
      const floor = deriveDayFloor(day, hourly);
      findings.push({
        id: `rate_card.derived_day_floor:${row.specialtyId ?? row.specialty}`,
        severity: "info",
        category: "rate_card",
        title: `Uneven day/hourly ratio: ${row.position} / ${row.specialty}`,
        detail:
          `Day $${day.toFixed(2)} ÷ hourly $${hourly.toFixed(2)} = ${ratio.toFixed(2)} hrs, `
          + `so the day rate is treated as covering ${floor} hr${floor === 1 ? "" : "s"} per worker.`,
        downstream:
          `On day-rate timesheet billing, overflow hours start after ${floor} hrs — not `
          + `${ratio.toFixed(2)}. If the contract says a different number, the rates need to `
          + `divide evenly (e.g. ${(hourly * floor).toFixed(2)} day at $${hourly.toFixed(2)}/hr).`,
        fixHref: "/rate-card",
        fixLabel: "Review row",
      });
    }
    return findings;
  },

  // 7. Holiday multiplier
  (ctx) => {
    if (!ctx.rateCard) return [];
    if (ctx.rateCard.holidayMultiplier && ctx.rateCard.holidayMultiplier > 0) return [];
    return [{
      id: "rate_card.no_holiday_multiplier",
      severity: "info",
      category: "rate_card",
      title: "Rate card has no holiday multiplier",
      detail: "Holiday-flagged days will calc as regular days.",
      downstream: "If the job has holiday days, the customer won't be billed the holiday premium.",
      fixHref: "/rate-card",
      fixLabel: "Set multiplier",
    }];
  },
];
