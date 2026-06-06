// Timesheet + invoice checks. Catch missing specialties on entries (which
// block bill-rate resolution), unbilled approved days, and $0 invoice lines.

import type { CheckFn, Finding } from "../types";

export const timesheetInvoiceChecks: CheckFn[] = [
  // 1. Approved entries missing specialty_id — one finding per entry so
  //    operator can tick them off individually. Deep-links to timekeeping.
  (ctx) => {
    const findings: Finding[] = [];
    for (const e of ctx.timesheetEntries) {
      if (e.status !== "approved" || e.specialtyId) continue;
      const who = `${e.firstName ?? ""} ${e.lastName ?? ""}`.trim() || "(unknown crew)";
      const when = e.workDate ?? "(no date)";
      findings.push({
        id: `timesheet.missing_specialty:${e.id}`,
        severity: "blocker",
        category: "timesheet",
        title: `Missing specialty: ${who} · ${when}`,
        detail: "Approved timesheet entry has no specialty assigned.",
        downstream: "Bill-rate lookup against the rate card fails. Invoice generation skips or zeroes this entry.",
        fixHref: "/timekeeping",
        fixLabel: "Open timekeeping",
      });
    }
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

  // 5. Duplicate employee records used on this job's timesheet — one
  //    finding per duplicated human so each merge is its own action item.
  //    (Related to project_employee_dedup — weekly OT spill breaks when
  //    one human exists twice in the employees table.)
  (ctx) => {
    const byName = new Map<string, { display: string; keys: Set<string> }>();
    for (const e of ctx.timesheetEntries) {
      if (!e.employeeKey) continue;
      const first = (e.firstName ?? "").trim();
      const last = (e.lastName ?? "").trim();
      const display = `${first} ${last}`.trim();
      if (!display) continue;
      const norm = display.toLowerCase();
      const entry = byName.get(norm) ?? { display, keys: new Set<string>() };
      entry.keys.add(e.employeeKey);
      byName.set(norm, entry);
    }
    const findings: Finding[] = [];
    for (const [norm, { display, keys }] of byName) {
      if (keys.size < 2) continue;
      findings.push({
        id: `timesheet.duplicate_employee:${norm}`,
        severity: "warning",
        category: "timesheet",
        title: `Duplicate employee: ${display}`,
        detail: `Same human appears under ${keys.size} different employee records on this job's timesheet.`,
        downstream: "Weekly OT spill won't roll up correctly across the duplicates — payroll may miss OT.",
        fixHref: "/employee-directory",
        fixLabel: "Open employee directory",
      });
    }
    return findings;
  },
];
