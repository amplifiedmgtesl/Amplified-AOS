// Timesheet + invoice checks. Catch missing specialties on entries (which
// block bill-rate resolution), unbilled approved days, and $0 invoice lines.

import type { CheckFn, Finding } from "../types";

export const timesheetInvoiceChecks: CheckFn[] = [
  // 1. Approved entries missing specialty_id
  (ctx) => {
    const findings: Finding[] = [];
    const bad = ctx.timesheetEntries.filter((e) => e.status === "approved" && !e.specialtyId);
    if (bad.length === 0) return findings;
    findings.push({
      id: "timesheet.missing_specialty",
      severity: "blocker",
      category: "timesheet",
      title: `${bad.length} approved timesheet entr${bad.length === 1 ? "y" : "ies"} missing specialty`,
      detail: `Entries: ${bad.slice(0, 5).map((e) => `${e.firstName} ${e.lastName} ${e.workDate ?? ""}`).join("; ")}${bad.length > 5 ? `, +${bad.length - 5} more` : ""}`,
      downstream: "Bill rate can't be resolved from the rate card. Invoice generation will skip or zero these entries.",
      fixHref: "/timekeeping",
      fixLabel: "Open timekeeping",
    });
    return findings;
  },

  // 2. Entry specialty exists on the resolved rate card
  (ctx) => {
    if (!ctx.rateCard) return [];
    const findings: Finding[] = [];
    const cardSpecialties = new Set(ctx.rateCard.rows.map((r) => r.specialtyId).filter(Boolean));
    const specName = new Map(ctx.specialties.map((s) => [s.id, s.name] as const));
    const orphaned = new Map<string, number>();
    for (const e of ctx.timesheetEntries) {
      if (!e.specialtyId) continue;
      if (cardSpecialties.has(e.specialtyId)) continue;
      orphaned.set(e.specialtyId, (orphaned.get(e.specialtyId) ?? 0) + 1);
    }
    for (const [specId, count] of orphaned) {
      const name = specName.get(specId) ?? specId;
      findings.push({
        id: `timesheet.specialty_off_card:${specId}`,
        severity: "blocker",
        category: "timesheet",
        title: `Timesheet uses specialty not on rate card: ${name}`,
        detail: `${count} entr${count === 1 ? "y" : "ies"} reference ${name}, which has no row on the resolved rate card.`,
        downstream: "Bill-rate lookup falls back to $0; payroll lookup falls back to $0.",
        fixHref: "/rate-card",
        fixLabel: "Add row to rate card",
      });
    }
    return findings;
  },

  // 3. Approved timesheet days that haven't been pulled onto an invoice yet
  (ctx) => {
    const approved = ctx.timesheetEntries.filter((e) => e.status === "approved");
    const unbilledDays = new Set<string>();
    for (const e of approved) {
      if (!e.invoiceLineId && e.workDate) unbilledDays.add(e.workDate);
    }
    if (unbilledDays.size === 0) return [];
    const list = [...unbilledDays].sort();
    return [{
      id: "invoice.unbilled_approved_days",
      severity: "warning",
      category: "invoice",
      title: `${unbilledDays.size} approved day${unbilledDays.size === 1 ? "" : "s"} not yet on an invoice`,
      detail: `Unbilled: ${list.slice(0, 5).join(", ")}${list.length > 5 ? `, +${list.length - 5} more` : ""}`,
      downstream: "Customer hasn't been billed for confirmed work — revenue sits on the table.",
      fixHref: "/invoices",
      fixLabel: "Open invoices",
    }];
  },

  // 4. $0 lines on an issued invoice
  (ctx) => {
    const findings: Finding[] = [];
    for (const inv of ctx.invoices) {
      if (inv.isDraft) continue;
      const zero = inv.lines.filter((ln) => (ln.total ?? 0) === 0);
      if (zero.length === 0) continue;
      findings.push({
        id: `invoice.zero_lines:${inv.id}`,
        severity: "blocker",
        category: "invoice",
        title: `Invoice ${inv.invoiceNo || inv.id} has ${zero.length} $0 line${zero.length === 1 ? "" : "s"}`,
        detail: "Rate resolution failed at issue time — the customer is being under-billed for these lines.",
        downstream: "AR will be short. Revise the invoice once the rate card is corrected.",
        fixHref: `/invoices/${encodeURIComponent(inv.id)}`,
        fixLabel: "Open invoice",
      });
    }
    return findings;
  },

  // 5. Duplicate employee records used on this job's timesheet
  // (related to project_employee_dedup — weekly OT spill breaks when one
  // human exists twice in the employees table)
  (ctx) => {
    const byName = new Map<string, Set<string>>();
    for (const e of ctx.timesheetEntries) {
      if (!e.employeeKey) continue;
      const name = `${(e.firstName || "").toLowerCase().trim()} ${(e.lastName || "").toLowerCase().trim()}`.trim();
      if (!name) continue;
      if (!byName.has(name)) byName.set(name, new Set());
      byName.get(name)!.add(e.employeeKey);
    }
    const dupes: string[] = [];
    for (const [name, keys] of byName) {
      if (keys.size > 1) dupes.push(name);
    }
    if (dupes.length === 0) return [];
    return [{
      id: "timesheet.duplicate_employees",
      severity: "warning",
      category: "timesheet",
      title: `${dupes.length} employee${dupes.length === 1 ? "" : "s"} appears under multiple records`,
      detail: `Same human, two employee_key rows: ${dupes.slice(0, 3).join(", ")}${dupes.length > 3 ? `, +${dupes.length - 3} more` : ""}`,
      downstream: "Weekly OT spill won't roll up correctly across the duplicates — payroll may miss OT.",
      fixHref: "/employee-directory",
      fixLabel: "Open employee directory",
    }];
  },
];
