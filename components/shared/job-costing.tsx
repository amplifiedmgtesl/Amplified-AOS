
"use client";

import { useEffect, useMemo, useState } from "react";
import { getActiveRateCardProfileId, loadRateCardProfiles, loadRateRows } from "@/lib/rates/storage";
import {
  getActiveJobCosting,
  getTimesheetByJobSheetId,
  loadJobCostingDrafts,
  loadJobRequests,
  loadJobSheets,
  loadQuotes,
  loadTimesheets,
  setActiveJobCosting,
  upsertJobCostingDraft,
} from "@/lib/store/app-store";
import type { JobCostingDraft, JobCostingLine, JobRequest, JobSheet, QuoteDraft, TimeEntry, Timesheet } from "@/lib/store/types";

const ROLES = [
  "Stagehand",
  "Stagehand Lead",
  "Rigger",
  "Head Rigger",
  "Audio Tech A1",
  "Audio Tech A2",
  "Lighting Tech L1",
  "Lighting Tech L2",
  "Video Tech V1",
  "Video Tech V2",
  "Forklift Operator",
  "Heavy Equipment Operator",
  "Aerial Lift Operator",
  "Site Operations",
  "General Labor",
];

const GLOBAL_DEFAULTS = {
  payrollBurden: 0.15,
  overheadPerHour: 3,
  targetMargin: 0.25,
  otPayMultiplier: 1.5,
  dtPayMultiplier: 2.0,
  otBillMultiplier: 1.5,
  dtBillMultiplier: 2.0,
  minimumHours: 5,
};

function roundMoney(n: number) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function calcSellRate(payRate: number, payrollBurden = 0.15, overheadPerHour = 3, targetMargin = 0.25) {
  const loadedCostPerHour = (payRate * (1 + payrollBurden)) + overheadPerHour;
  return roundMoney(loadedCostPerHour / Math.max(0.01, (1 - targetMargin)));
}

function calcMinimumAdjustedHours(stHours: number, otHours: number, dtHours: number, minimumHours: number) {
  const total = Number(stHours || 0) + Number(otHours || 0) + Number(dtHours || 0);
  if (total >= minimumHours) return roundMoney(Number(stHours || 0));
  return roundMoney(Number(stHours || 0) + (minimumHours - total));
}

function calcActualCostPerHour(actualPayRate: number, payrollBurden: number, overheadPerHour: number) {
  return roundMoney((actualPayRate * (1 + payrollBurden)) + overheadPerHour);
}

function calcActualOtCostPerHour(actualPayRate: number, payrollBurden: number, overheadPerHour: number, otPayMultiplier: number) {
  return roundMoney(((actualPayRate * otPayMultiplier) * (1 + payrollBurden)) + overheadPerHour);
}

function calcActualDtCostPerHour(actualPayRate: number, payrollBurden: number, overheadPerHour: number, dtPayMultiplier: number) {
  return roundMoney(((actualPayRate * dtPayMultiplier) * (1 + payrollBurden)) + overheadPerHour);
}


function effectiveActualCrewCount(line: JobCostingLine) {
  return Number(line.actualCrewCount || 0) > 0 ? Number(line.actualCrewCount || 0) : Number(line.crewCount || 0);
}

function effectiveActualPayRate(line: JobCostingLine) {
  return Number(line.actualPayRate || 0) > 0 ? Number(line.actualPayRate || 0) : Number(line.payRate || 0);
}

function effectiveActualSTHours(line: JobCostingLine, minimumHours: number) {
  if (Number(line.actualSTHours || 0) > 0 || Number(line.actualOTHours || 0) > 0 || Number(line.actualDTHours || 0) > 0) {
    return Number(line.actualSTHours || 0);
  }
  return calcMinimumAdjustedHours(Number(line.stHours || 0), Number(line.otHours || 0), Number(line.dtHours || 0), minimumHours);
}

function effectiveActualOTHours(line: JobCostingLine) {
  if (Number(line.actualSTHours || 0) > 0 || Number(line.actualOTHours || 0) > 0 || Number(line.actualDTHours || 0) > 0) {
    return Number(line.actualOTHours || 0);
  }
  return Number(line.otHours || 0);
}

function effectiveActualDTHours(line: JobCostingLine) {
  if (Number(line.actualSTHours || 0) > 0 || Number(line.actualOTHours || 0) > 0 || Number(line.actualDTHours || 0) > 0) {
    return Number(line.actualDTHours || 0);
  }
  return Number(line.dtHours || 0);
}

function effectiveActualExpenses(line: JobCostingLine) {
  return Number(line.actualExpenses || 0) > 0 ? Number(line.actualExpenses || 0) : Number(line.quotedExpenses || 0);
}

function parseQuoteLine(line: QuoteDraft["lines"][number]) {
  const parts = (line.serviceKey || "").split(" | ");
  const position = parts[2] || "Stagehand";
  const rateMode = ((parts[4] || "").toLowerCase() === "day" ? "day" : "hourly") as "hourly" | "day";
  return { position, rateMode };
}

function parseQuoteOtTrigger(rule: string) {
  const m = (rule || "").match(/OT after\s+(\d+(?:\.\d+)?)/i);
  return m ? Number(m[1]) : 10;
}

function roleFromPosition(position: string) {
  const p = (position || "").toLowerCase();
  if (p.includes("head rigger") || p.includes("rigger 1")) return "Head Rigger";
  if (p.includes("rigger")) return "Rigger";
  if (p.includes("a1")) return "Audio Tech A1";
  if (p.includes("a2")) return "Audio Tech A2";
  if (p.includes("l1")) return "Lighting Tech L1";
  if (p.includes("l2")) return "Lighting Tech L2";
  if (p.includes("v1")) return "Video Tech V1";
  if (p.includes("v2")) return "Video Tech V2";
  if (p.includes("fork")) return "Forklift Operator";
  if (p.includes("heavy")) return "Heavy Equipment Operator";
  if (p.includes("aerial")) return "Aerial Lift Operator";
  if (p.includes("crew chief") || p.includes("lead")) return "Stagehand Lead";
  if (p.includes("operations") || p.includes("site")) return "Site Operations";
  if (p.includes("labor")) return "General Labor";
  return "Stagehand";
}

function blankLine(id: string): JobCostingLine {
  return {
    id,
    role: "Stagehand",
    payRate: 25,
    crewCount: 1,
    stHours: 5,
    otHours: 0,
    dtHours: 0,
    stRate: 0,
    otRate: 0,
    dtRate: 0,
    quotedExpenses: 0,
    actualPayRate: 25,
    actualCrewCount: 1,
    actualSTHours: 0,
    actualOTHours: 0,
    actualDTHours: 0,
    actualExpenses: 0,
    targetMargin: GLOBAL_DEFAULTS.targetMargin,
    billMode: "hourly",
    quotedBaseDay: 0,
    quotedOtTrigger: 10,
    manualRateOverride: false,
    manualOtOverride: false,
    manualDtOverride: false,
  };
}

function applyQuotedRates(line: JobCostingLine, globals: Pick<JobCostingDraft, "payrollBurden"|"overheadPerHour"|"otBillMultiplier"|"dtBillMultiplier">) {
  const base = calcSellRate(line.payRate, globals.payrollBurden, globals.overheadPerHour, line.targetMargin);
  return {
    ...line,
    stRate: line.manualRateOverride ? line.stRate : base,
    otRate: line.manualOtOverride ? line.otRate : roundMoney(base * globals.otBillMultiplier),
    dtRate: line.manualDtOverride ? line.dtRate : roundMoney(base * globals.dtBillMultiplier),
  };
}

function summarizeTimeEntries(rows: TimeEntry[]) {
  const map = new Map<string, { role:string; crew:number; st:number; ot:number; dt:number; avgPay:number; count:number }>();
  rows.forEach((r) => {
    const role = roleFromPosition(r.position || "Stagehand");
    if (!map.has(role)) map.set(role, { role, crew:0, st:0, ot:0, dt:0, avgPay:0, count:0 });
    const agg = map.get(role)!;
    agg.crew += 1;
    agg.st += Number(r.stdHours || 0);
    agg.ot += Number(r.otHours || 0);
    agg.dt += Number(r.dtHours || 0);
    agg.avgPay += Number(r.stdRate || 0);
    agg.count += 1;
  });
  return Array.from(map.values()).map((r) => ({
    role: r.role,
    crew: r.crew,
    st: roundMoney(r.st),
    ot: roundMoney(r.ot),
    dt: roundMoney(r.dt),
    avgPay: roundMoney(r.count ? r.avgPay / r.count : 0),
  }));
}

function defaultDraft(): JobCostingDraft {
  const now = new Date().toISOString();
  return {
    id: `jobcost-${Date.now()}`,
    title: "New Job Costing",
    client: "",
    eventName: "",
    venue: "",
    cityState: "",
    linkedJobRequestId: "",
    linkedQuoteId: "",
    linkedJobSheetId: "",
    linkedTimesheetId: "",
    linkedRateCardProfileId: getActiveRateCardProfileId() || "",
    ...GLOBAL_DEFAULTS,
    billedExpenses: 0,
    rentals: 0,
    passThroughMarkupRevenue: 0,
    actualTravel: 0,
    actualHotels: 0,
    actualPerDiem: 0,
    actualEquipment: 0,
    actualOtherCosts: 0,
    actualRevenueCollected: 0,
    estimatedJobCost: 0,
    lines: [applyQuotedRates(blankLine(`line-${Date.now()}`), GLOBAL_DEFAULTS)],
    createdAt: now,
    updatedAt: now,
  };
}

function roleRateSeed(role: string) {
  const rows = loadRateRows();
  const profiles = [
    { match: "Stagehand Lead", keys: ["crew chief", "lead"] },
    { match: "Stagehand", keys: ["stagehand", "labor"] },
    { match: "Head Rigger", keys: ["head rigger", "rigger 1"] },
    { match: "Rigger", keys: ["rigger"] },
    { match: "Audio Tech A1", keys: ["audio technician | a1", "a1"] },
    { match: "Audio Tech A2", keys: ["audio technician | a2", "a2"] },
    { match: "Lighting Tech L1", keys: ["lighting technician | l1", "l1"] },
    { match: "Lighting Tech L2", keys: ["lighting technician | l2", "l2"] },
    { match: "Video Tech V1", keys: ["video technician | v1", "v1"] },
    { match: "Video Tech V2", keys: ["video technician | v2", "v2"] },
    { match: "Forklift Operator", keys: ["fork op"] },
    { match: "Heavy Equipment Operator", keys: ["fork op"] },
    { match: "Aerial Lift Operator", keys: ["operations", "lift"] },
    { match: "Site Operations", keys: ["operations", "services"] },
    { match: "General Labor", keys: ["stagehand", "labor"] },
  ];
  const profile = profiles.find((p) => p.match === role);
  const row = rows.find((r) => {
    const hay = `${r.group} | ${r.position} | ${r.specialty}`.toLowerCase();
    return profile ? profile.keys.some((k) => hay.includes(k)) : false;
  }) || rows[0];
  return row;
}

export default function JobCosting() {
  const [drafts, setDrafts] = useState<JobCostingDraft[]>([]);
  const [draft, setDraft] = useState<JobCostingDraft>(defaultDraft());
  const [statusMsg, setStatusMsg] = useState("");
  const requests = useMemo(() => loadJobRequests(), []);
  const quotes = useMemo(() => loadQuotes(), []);
  const jobSheets = useMemo(() => loadJobSheets(), []);
  const timesheets = useMemo(() => loadTimesheets(), []);
  const rateProfiles = useMemo(() => loadRateCardProfiles(), []);

  useEffect(() => {
    const rows = loadJobCostingDrafts();
    setDrafts(rows);
    const activeId = getActiveJobCosting();
    const active = rows.find((r) => r.id === activeId) || rows[0];
    if (active) setDraft(active);
  }, []);

  function persist(next: JobCostingDraft, message?: string) {
    const updated = { ...next, updatedAt: new Date().toISOString() };
    setDraft(updated);
    upsertJobCostingDraft(updated);
    setActiveJobCosting(updated.id);
    const rows = loadJobCostingDrafts();
    setDrafts(rows);
    if (message) setStatusMsg(message);
  }

  function patch(p: Partial<JobCostingDraft>) {
    persist({ ...draft, ...p });
  }

  function patchLine(id: string, p: Partial<JobCostingLine>, forceManual = false) {
    const nextLines = draft.lines.map((line) => {
      if (line.id !== id) return line;
      let next = { ...line, ...p };
      if (forceManual && Object.prototype.hasOwnProperty.call(p, "stRate")) next.manualRateOverride = true;
      if (forceManual && Object.prototype.hasOwnProperty.call(p, "otRate")) next.manualOtOverride = true;
      if (forceManual && Object.prototype.hasOwnProperty.call(p, "dtRate")) next.manualDtOverride = true;
      next = applyQuotedRates(next, draft);
      return next;
    });
    persist({ ...draft, lines: nextLines });
  }

  function addLine() {
    const row = roleRateSeed("Stagehand");
    const line = applyQuotedRates({
      ...blankLine(`line-${Date.now()}`),
      role: "Stagehand",
      stRate: row?.hourly || 0,
      otRate: row?.otRate || 0,
      dtRate: row?.dtRate || 0,
    }, draft);
    persist({ ...draft, lines: [...draft.lines, line] }, "Line added.");
  }

  function deleteLine(id: string) {
    persist({ ...draft, lines: draft.lines.filter((l) => l.id !== id) }, "Line deleted.");
  }

  function openDraft(id: string) {
    const found = loadJobCostingDrafts().find((r) => r.id === id);
    if (!found) return;
    setDraft(found);
    setActiveJobCosting(found.id);
  }

  function saveAsNewDraft() {
    const next = { ...draft, id: `jobcost-${Date.now()}`, title: `${draft.title || "Job Costing"} Copy`, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    persist(next, "Saved as new draft.");
  }

  function syncJobRequest(id: string) {
    const req = requests.find((r) => r.id === id);
    if (!req) return;
    persist({
      ...draft,
      title: `${req.client} - ${req.eventName} Costing`,
      client: req.client,
      eventName: req.eventName,
      venue: req.venue,
      cityState: req.cityState,
      linkedJobRequestId: req.id,
    }, "Job request synced.");
  }

  function syncQuote(id: string) {
    const q = quotes.find((r) => r.id === id);
    if (!q) return;
    const lines = q.lines.length ? q.lines.map((line, idx) => {
      const meta = parseQuoteLine(line);
      const role = roleFromPosition(meta.position);
      const otTrigger = parseQuoteOtTrigger(line.rule || "");
      const totalHours = Number(line.hours || 0);
      const quotedOtHours = meta.rateMode === "day" ? Math.max(0, Math.min(totalHours, 15) - otTrigger) : 0;
      const quotedDtHours = meta.rateMode === "day" ? Math.max(0, totalHours - 15) : 0;
      const quotedStHours = meta.rateMode === "day" ? Math.min(totalHours, otTrigger) : totalHours;
      const sourceRate = Number(line.baseHourly || 0);
      const seededPayRate = sourceRate > 0
        ? Math.max(0, roundMoney(((sourceRate * (1 - draft.targetMargin)) - draft.overheadPerHour) / (1 + draft.payrollBurden)))
        : 0;

      return applyQuotedRates({
        ...blankLine(`line-${Date.now()}-${idx}`),
        role,
        billMode: meta.rateMode,
        quotedBaseDay: Number((line as any).baseDay || 0),
        quotedOtTrigger: otTrigger,
        payRate: seededPayRate,
        crewCount: Number(line.qty || 1),
        stHours: quotedStHours,
        otHours: quotedOtHours,
        dtHours: quotedDtHours,
        stRate: Number(line.baseHourly || 0),
        otRate: Number(line.otRate || 0),
        dtRate: Number(line.dtRate || 0),
        quotedExpenses: Number(line.travel || 0),
        targetMargin: draft.targetMargin,
        manualRateOverride: true,
        manualOtOverride: true,
        manualDtOverride: true,
      }, draft);
    }) : draft.lines;
    persist({
      ...draft,
      title: `${q.client} - ${q.eventName} Costing`,
      client: q.client,
      eventName: q.eventName,
      venue: q.venue,
      cityState: q.cityState,
      linkedQuoteId: q.id,
      linkedJobRequestId: q.linkedJobRequestId || draft.linkedJobRequestId,
      linkedJobSheetId: q.linkedJobSheetId || draft.linkedJobSheetId,
      linkedRateCardProfileId: q.rateCardProfileId || draft.linkedRateCardProfileId,
      lines,
    }, "Quote synced.");
  }

  function syncJobSheet(id: string) {
    const sheet = jobSheets.find((r) => r.id === id);
    if (!sheet) return;
    persist({
      ...draft,
      client: sheet.client,
      eventName: sheet.eventName,
      venue: sheet.venue,
      cityState: sheet.cityState,
      linkedJobSheetId: sheet.id,
      title: `${sheet.client} - ${sheet.eventName} Costing`,
    }, "Job sheet synced.");
  }

  function syncTimekeepingByJobSheet(id: string) {
    const timesheet = getTimesheetByJobSheetId(id) || timesheets.find((t) => t.jobSheetId === id);
    if (!timesheet) {
      setStatusMsg("No linked timesheet found for that job sheet.");
      return;
    }
    const summary = summarizeTimeEntries(timesheet.rows || []);
    const used = new Set<string>();
    const nextLines = [...draft.lines].map((line) => {
      const match = summary.find((s) => s.role === line.role && !used.has(s.role));
      if (!match) return line;
      used.add(match.role);
      return applyQuotedRates({
        ...line,
        actualPayRate: match.avgPay || line.actualPayRate,
        actualCrewCount: match.crew || line.actualCrewCount,
        actualSTHours: match.st || line.actualSTHours,
        actualOTHours: match.ot || line.actualOTHours,
        actualDTHours: match.dt || line.actualDTHours,
      }, draft);
    });
    summary.forEach((s, idx) => {
      if (used.has(s.role)) return;
      const seed = roleRateSeed(s.role);
      nextLines.push(applyQuotedRates({
        ...blankLine(`line-ts-${Date.now()}-${idx}`),
        role: s.role,
        payRate: seed ? roundMoney(((seed.hourly * (1 - draft.targetMargin) - draft.overheadPerHour) / 1.15)) : 25,
        actualPayRate: s.avgPay,
        actualCrewCount: s.crew,
        actualSTHours: s.st,
        actualOTHours: s.ot,
        actualDTHours: s.dt,
        stRate: seed?.hourly || 0,
        otRate: seed?.otRate || 0,
        dtRate: seed?.dtRate || 0,
        targetMargin: draft.targetMargin,
      }, draft));
    });
    persist({ ...draft, linkedJobSheetId: id, linkedTimesheetId: timesheet.id, lines: nextLines }, "Timekeeping synced.");
  }

  function syncRateCard(id: string) {
    const profile = rateProfiles.find((p) => p.id === id);
    if (!profile) return;
    const nextLines = draft.lines.map((line) => {
      const row = roleRateSeed(line.role);
      return applyQuotedRates({
        ...line,
        stRate: row?.hourly || line.stRate,
        otRate: row?.otRate || line.otRate,
        dtRate: row?.dtRate || line.dtRate,
      }, draft);
    });
    persist({ ...draft, linkedRateCardProfileId: profile.id, lines: nextLines }, "Rate card linked.");
  }

  const computedLines = useMemo(() => {
    return draft.lines.map((line) => {
      const billMode = line.billMode || "hourly";
      const loadedCostPerHour = roundMoney((line.payRate * (1 + draft.payrollBurden)) + draft.overheadPerHour);

      const quotedSTHours = Number(line.stHours || 0);
      const quotedOTHours = Number(line.otHours || 0);
      const quotedDTHours = Number(line.dtHours || 0);
      const quotedExpenses = Number(line.quotedExpenses || 0);

      let quotedSTRevenue = 0;
      let quotedOTRevenue = 0;
      let quotedDTRevenue = 0;

      if (billMode === "day") {
        quotedSTRevenue = roundMoney(Number(line.quotedBaseDay || 0) * Number(line.crewCount || 0));
        quotedOTRevenue = roundMoney(Number(line.otRate || 0) * quotedOTHours * Number(line.crewCount || 0));
        quotedDTRevenue = roundMoney(Number(line.dtRate || 0) * quotedDTHours * Number(line.crewCount || 0));
      } else {
        quotedSTRevenue = roundMoney(Number(line.stRate || 0) * quotedSTHours * Number(line.crewCount || 0));
        quotedOTRevenue = roundMoney(Number(line.otRate || 0) * quotedOTHours * Number(line.crewCount || 0));
        quotedDTRevenue = roundMoney(Number(line.dtRate || 0) * quotedDTHours * Number(line.crewCount || 0));
      }

      const lineRevenueTotal = roundMoney(quotedSTRevenue + quotedOTRevenue + quotedDTRevenue + quotedExpenses);

      const actualCrewCountUsed = effectiveActualCrewCount(line);
      const actualPayRateUsed = effectiveActualPayRate(line);
      const actualSTHoursUsed = effectiveActualSTHours(line, draft.minimumHours);
      const actualOTHoursUsed = effectiveActualOTHours(line);
      const actualDTHoursUsed = effectiveActualDTHours(line);
      const actualExpensesUsed = effectiveActualExpenses(line);

      const stCostPerHour = calcActualCostPerHour(actualPayRateUsed, draft.payrollBurden, draft.overheadPerHour);
      const otCostPerHour = calcActualOtCostPerHour(actualPayRateUsed, draft.payrollBurden, draft.overheadPerHour, draft.otPayMultiplier);
      const dtCostPerHour = calcActualDtCostPerHour(actualPayRateUsed, draft.payrollBurden, draft.overheadPerHour, draft.dtPayMultiplier);

      const lineActualSTCost = roundMoney(stCostPerHour * actualSTHoursUsed * actualCrewCountUsed);
      const lineActualOTCost = roundMoney(otCostPerHour * actualOTHoursUsed * actualCrewCountUsed);
      const lineActualDTCost = roundMoney(dtCostPerHour * actualDTHoursUsed * actualCrewCountUsed);
      const lineActualTotalCost = roundMoney(lineActualSTCost + lineActualOTCost + lineActualDTCost + actualExpensesUsed);

      const lineProfit = roundMoney(lineRevenueTotal - lineActualTotalCost);
      const lineMargin = lineRevenueTotal > 0 ? roundMoney(lineProfit / lineRevenueTotal) : 0;

      return {
        ...line,
        billMode,
        loadedCostPerHour,
        billedSTHours: quotedSTHours,
        quotedExpenses,
        quotedSTRevenue,
        quotedOTRevenue,
        quotedDTRevenue,
        lineRevenueTotal,
        actualCrewCountUsed,
        actualPayRateUsed,
        actualSTHoursUsed,
        actualOTHoursUsed,
        actualDTHoursUsed,
        actualExpensesUsed,
        stCostPerHour,
        otCostPerHour,
        dtCostPerHour,
        lineActualSTCost,
        lineActualOTCost,
        lineActualDTCost,
        lineActualTotalCost,
        lineProfit,
        lineMargin,
      };
    });
  }, [draft]);

  const totals = useMemo(() => {
    const quotedLaborRevenue = roundMoney(computedLines.reduce((s, l) => s + l.lineRevenueTotal, 0));
    const totalQuotedRevenue = roundMoney(quotedLaborRevenue + draft.billedExpenses + draft.rentals + draft.passThroughMarkupRevenue);
    const actualLaborCost = roundMoney(computedLines.reduce((s, l) => s + l.lineActualTotalCost, 0));
    const totalActualJobCost = roundMoney(actualLaborCost + draft.actualTravel + draft.actualHotels + draft.actualPerDiem + draft.actualEquipment + draft.actualOtherCosts);
    const grossProfit = roundMoney(totalQuotedRevenue - totalActualJobCost);
    const grossMargin = totalQuotedRevenue > 0 ? roundMoney(grossProfit / totalQuotedRevenue) : 0;
    const marginVariance = roundMoney(grossMargin - draft.targetMargin);
    const revenueVariance = roundMoney(draft.actualRevenueCollected - totalQuotedRevenue);
    const costVariance = roundMoney(totalActualJobCost - draft.estimatedJobCost);
    return { quotedLaborRevenue, totalQuotedRevenue, actualLaborCost, totalActualJobCost, grossProfit, grossMargin, marginVariance, revenueVariance, costVariance };
  }, [computedLines, draft]);

  return (
    <div className="grid">
      <div className="card">
        <h2 className="section-title">Job Costing Control Center</h2>
        <div className="grid4">
        <div className="muted" style={{ gridColumn: "1 / -1" }}>Client quoted bill rates and worker payout rates are calculated separately. If actual worker pay, actual hours, or actual expenses have not been entered yet, the costing page now falls back to quoted pay, quoted hours, minimum billed hours, and quoted expenses so margin is not overstated.</div>
          <div>
            <small>Open Draft</small>
            <select value={draft.id} onChange={(e) => openDraft(e.target.value)}>
              {drafts.length === 0 ? <option value={draft.id}>{draft.title}</option> : drafts.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
            </select>
          </div>
          <div><small>Draft Title</small><input value={draft.title} onChange={(e) => patch({ title: e.target.value })} /></div>
          <div className="action-row" style={{ alignItems: "end" }}><button type="button" className="secondary" onClick={() => persist(draft, "Draft saved.")}>Save Draft</button></div>
          <div className="action-row" style={{ alignItems: "end" }}><button type="button" className="secondary" onClick={saveAsNewDraft}>Save As New Draft</button></div>

          <div>
            <small>Link Job Request</small>
            <select value={draft.linkedJobRequestId || ""} onChange={(e) => syncJobRequest(e.target.value)}>
              <option value="">None</option>
              {requests.map((r) => <option key={r.id} value={r.id}>{r.client} — {r.eventName}</option>)}
            </select>
          </div>
          <div>
            <small>Link Quote</small>
            <select value={draft.linkedQuoteId || ""} onChange={(e) => syncQuote(e.target.value)}>
              <option value="">None</option>
              {quotes.map((q) => <option key={q.id} value={q.id}>{q.client} — {q.eventName}</option>)}
            </select>
          </div>
          <div>
            <small>Link Job Sheet</small>
            <select value={draft.linkedJobSheetId || ""} onChange={(e) => syncJobSheet(e.target.value)}>
              <option value="">None</option>
              {jobSheets.map((j) => <option key={j.id} value={j.id}>{j.client} — {j.eventName}</option>)}
            </select>
          </div>
          <div>
            <small>Linked Rate Card</small>
            <select value={draft.linkedRateCardProfileId || ""} onChange={(e) => syncRateCard(e.target.value)}>
              <option value="">Current / None</option>
              {rateProfiles.map((p) => <option key={p.id} value={p.id}>{p.clientName}</option>)}
            </select>
          </div>

          <div className="action-row" style={{ alignItems: "end" }}>
            <button type="button" className="secondary" onClick={() => syncTimekeepingByJobSheet(draft.linkedJobSheetId || "")}>Sync Timekeeping Actuals</button>
          </div>
          <div><small>Client</small><input value={draft.client} onChange={(e) => patch({ client: e.target.value })} /></div>
          <div><small>Event Name</small><input value={draft.eventName} onChange={(e) => patch({ eventName: e.target.value })} /></div>
          <div><small>Venue</small><input value={draft.venue} onChange={(e) => patch({ venue: e.target.value })} /></div>
          <div><small>City / State</small><input value={draft.cityState} onChange={(e) => patch({ cityState: e.target.value })} /></div>
        </div>

        <div className="grid4" style={{ marginTop: 12 }}>
          <div><small>Payroll Burden</small><input type="number" step="0.01" value={draft.payrollBurden} onChange={(e) => patch({ payrollBurden: Number(e.target.value || 0) })} /></div>
          <div><small>Overhead / Hour</small><input type="number" step="0.01" value={draft.overheadPerHour} onChange={(e) => patch({ overheadPerHour: Number(e.target.value || 0) })} /></div>
          <div><small>Target Margin</small><input type="number" step="0.01" value={draft.targetMargin} onChange={(e) => patch({ targetMargin: Number(e.target.value || 0) })} /></div>
          <div><small>Minimum Hours</small><input type="number" step="1" value={draft.minimumHours} onChange={(e) => patch({ minimumHours: Number(e.target.value || 0) })} /></div>
          <div><small>OT Pay Multiplier</small><input type="number" step="0.1" value={draft.otPayMultiplier} onChange={(e) => patch({ otPayMultiplier: Number(e.target.value || 0) })} /></div>
          <div><small>DT Pay Multiplier</small><input type="number" step="0.1" value={draft.dtPayMultiplier} onChange={(e) => patch({ dtPayMultiplier: Number(e.target.value || 0) })} /></div>
          <div><small>OT Bill Multiplier</small><input type="number" step="0.1" value={draft.otBillMultiplier} onChange={(e) => patch({ otBillMultiplier: Number(e.target.value || 0) })} /></div>
          <div><small>DT Bill Multiplier</small><input type="number" step="0.1" value={draft.dtBillMultiplier} onChange={(e) => patch({ dtBillMultiplier: Number(e.target.value || 0) })} /></div>
        </div>

        <div className="grid4" style={{ marginTop: 12 }}>
          <div><small>Billed Expenses</small><input type="number" value={draft.billedExpenses} onChange={(e) => patch({ billedExpenses: Number(e.target.value || 0) })} /></div>
          <div><small>Rentals</small><input type="number" value={draft.rentals} onChange={(e) => patch({ rentals: Number(e.target.value || 0) })} /></div>
          <div><small>Pass Through Markup Revenue</small><input type="number" value={draft.passThroughMarkupRevenue} onChange={(e) => patch({ passThroughMarkupRevenue: Number(e.target.value || 0) })} /></div>
          <div><small>Estimated Job Cost</small><input type="number" value={draft.estimatedJobCost} onChange={(e) => patch({ estimatedJobCost: Number(e.target.value || 0) })} /></div>
          <div><small>Actual Travel</small><input type="number" value={draft.actualTravel} onChange={(e) => patch({ actualTravel: Number(e.target.value || 0) })} /></div>
          <div><small>Actual Hotels</small><input type="number" value={draft.actualHotels} onChange={(e) => patch({ actualHotels: Number(e.target.value || 0) })} /></div>
          <div><small>Actual Per Diem</small><input type="number" value={draft.actualPerDiem} onChange={(e) => patch({ actualPerDiem: Number(e.target.value || 0) })} /></div>
          <div><small>Actual Equipment</small><input type="number" value={draft.actualEquipment} onChange={(e) => patch({ actualEquipment: Number(e.target.value || 0) })} /></div>
          <div><small>Actual Other Costs</small><input type="number" value={draft.actualOtherCosts} onChange={(e) => patch({ actualOtherCosts: Number(e.target.value || 0) })} /></div>
          <div><small>Actual Revenue Collected</small><input type="number" value={draft.actualRevenueCollected} onChange={(e) => patch({ actualRevenueCollected: Number(e.target.value || 0) })} /></div>
        </div>

        {statusMsg ? <div className="badge" style={{ marginTop: 12 }}>{statusMsg}</div> : null}
      </div>

      <div className="card">
        <div className="action-row" style={{ justifyContent: "space-between" }}>
          <h2 className="section-title" style={{ margin: 0 }}>Line-Level Costing</h2>
          <button type="button" className="secondary" onClick={addLine}>Add Line</button>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "max-content", minWidth: "2350px", fontSize: "12px" }}>
            <thead>
              <tr>
                <th>Role</th>
                <th>Bill Mode</th>
                <th>Worker Pay Rate</th>
                <th>Quoted Crew Count</th>
                <th>Quoted ST Hours</th>
                <th>Quoted OT Hours</th>
                <th>Quoted DT Hours</th>
                <th>Client ST Bill Rate</th>
                <th>Client OT Bill Rate</th>
                <th>Client DT Bill Rate</th>
                <th>Quoted Line Expenses</th>
                <th>Actual Worker Pay</th>
                <th>Actual Crew Count</th>
                <th>Actual ST Hours</th>
                <th>Actual OT Hours</th>
                <th>Actual DT Hours</th>
                <th>Actual Line Expenses</th>
                <th>Target Margin</th>
                <th>Delete</th>
              </tr>
            </thead>
            <tbody>
              {draft.lines.map((line) => (
                <tr key={line.id}>
                  <td>
                    <select style={{ minWidth: "180px" }} value={line.role} onChange={(e) => {
                      const role = e.target.value;
                      const row = roleRateSeed(role);
                      patchLine(line.id, {
                        role,
                        stRate: row?.hourly || line.stRate,
                        otRate: row?.otRate || line.otRate,
                        dtRate: row?.dtRate || line.dtRate,
                        manualRateOverride: false,
                        manualOtOverride: false,
                        manualDtOverride: false,
                      });
                    }}>
                      {ROLES.map((role) => <option key={role} value={role}>{role}</option>)}
                    </select>
                  </td>
                  <td><select style={{ minWidth: "110px" }} value={line.billMode || "hourly"} onChange={(e) => patchLine(line.id, { billMode: e.target.value as "hourly" | "day" })}><option value="hourly">Hourly</option><option value="day">Day</option></select></td>
                  <td><input style={{ minWidth: "120px" }} type="number" min="0" max="500" step="1" value={line.payRate} onChange={(e) => patchLine(line.id, { payRate: Number(e.target.value || 0) })} /></td>
                  <td><input style={{ minWidth: "110px" }} type="number" min="1" max="100" step="1" value={line.crewCount} onChange={(e) => patchLine(line.id, { crewCount: Number(e.target.value || 0) })} /></td>
                  <td><input style={{ minWidth: "110px" }} type="number" min="0" max="24" step="0.25" value={line.stHours} onChange={(e) => patchLine(line.id, { stHours: Number(e.target.value || 0) })} /></td>
                  <td><input style={{ minWidth: "110px" }} type="number" min="0" max="24" step="0.25" value={line.otHours} onChange={(e) => patchLine(line.id, { otHours: Number(e.target.value || 0) })} /></td>
                  <td><input style={{ minWidth: "110px" }} type="number" min="0" max="24" step="0.25" value={line.dtHours} onChange={(e) => patchLine(line.id, { dtHours: Number(e.target.value || 0) })} /></td>
                  <td><input style={{ minWidth: "125px" }} type="number" min="0" max="500" step="1" value={line.stRate} onChange={(e) => patchLine(line.id, { stRate: Number(e.target.value || 0) }, true)} /></td>
                  <td><input style={{ minWidth: "125px" }} type="number" min="0" max="500" step="1" value={line.otRate} onChange={(e) => patchLine(line.id, { otRate: Number(e.target.value || 0) }, true)} /></td>
                  <td><input style={{ minWidth: "125px" }} type="number" min="0" max="500" step="1" value={line.dtRate} onChange={(e) => patchLine(line.id, { dtRate: Number(e.target.value || 0) }, true)} /></td>
                  <td><input style={{ minWidth: "130px" }} type="number" min="0" max="5000" step="1" value={line.quotedExpenses} onChange={(e) => patchLine(line.id, { quotedExpenses: Number(e.target.value || 0) })} /></td>
                  <td><input style={{ minWidth: "120px" }} type="number" min="0" max="500" step="1" value={line.actualPayRate} onChange={(e) => patchLine(line.id, { actualPayRate: Number(e.target.value || 0) })} /></td>
                  <td><input style={{ minWidth: "110px" }} type="number" min="1" max="100" step="1" value={line.actualCrewCount} onChange={(e) => patchLine(line.id, { actualCrewCount: Number(e.target.value || 0) })} /></td>
                  <td><input style={{ minWidth: "110px" }} type="number" min="0" max="24" step="0.25" value={line.actualSTHours} onChange={(e) => patchLine(line.id, { actualSTHours: Number(e.target.value || 0) })} /></td>
                  <td><input style={{ minWidth: "110px" }} type="number" min="0" max="24" step="0.25" value={line.actualOTHours} onChange={(e) => patchLine(line.id, { actualOTHours: Number(e.target.value || 0) })} /></td>
                  <td><input style={{ minWidth: "110px" }} type="number" min="0" max="24" step="0.25" value={line.actualDTHours} onChange={(e) => patchLine(line.id, { actualDTHours: Number(e.target.value || 0) })} /></td>
                  <td><input style={{ minWidth: "130px" }} type="number" min="0" max="5000" step="1" value={line.actualExpenses} onChange={(e) => patchLine(line.id, { actualExpenses: Number(e.target.value || 0) })} /></td>
                  <td><input style={{ minWidth: "110px" }} type="number" min="0.1" max="0.4" step="0.01" value={line.targetMargin} onChange={(e) => patchLine(line.id, { targetMargin: Number(e.target.value || 0) })} /></td>
                  <td><button type="button" className="secondary" onClick={() => deleteLine(line.id)}>Delete</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h2 className="section-title">Calculated Line Results</h2>\n        <div className="muted" style={{ marginBottom: 10 }}>Margin is calculated as line profit divided by client revenue. Quoted revenue now matches the quote builder logic: hourly lines bill hourly rates by quoted hours, and day-rate lines bill the base day charge plus OT/DT add-ons.</div>
        <div style={{ overflowX: "auto" }}>
          <table>
            <thead>
              <tr>
                <th>Role</th>
                <th>Loaded Worker Cost / Hr</th>
                <th>Quoted ST Revenue</th>
                <th>Quoted OT Revenue</th>
                <th>Quoted DT Revenue</th>
                <th>Quoted Expenses</th>
                <th>Total Client Revenue</th>
                <th>Actual ST Payout Cost</th>
                <th>Actual OT Payout Cost</th>
                <th>Actual DT Payout Cost</th>
                <th>Actual Expenses</th>
                <th>Total Actual Cost</th>
                <th>Line Profit</th>
                <th>Line Margin</th>
              </tr>
            </thead>
            <tbody>
              {computedLines.map((line) => (
                <tr key={line.id}>
                  <td>{line.role}</td>
                  <td>${roundMoney((line.payRate * (1 + draft.payrollBurden)) + draft.overheadPerHour).toFixed(2)}</td>
                  <td>${line.quotedSTRevenue.toFixed(2)}</td>
                  <td>${line.quotedOTRevenue.toFixed(2)}</td>
                  <td>${line.quotedDTRevenue.toFixed(2)}</td>
                  <td>${line.quotedExpenses.toFixed(2)}</td>
                  <td>${line.lineRevenueTotal.toFixed(2)}</td>
                  <td>${line.lineActualSTCost.toFixed(2)}</td>
                  <td>${line.lineActualOTCost.toFixed(2)}</td>
                  <td>${line.lineActualDTCost.toFixed(2)}</td>
                  <td>${line.actualExpensesUsed.toFixed(2)}</td>
                  <td>${line.lineActualTotalCost.toFixed(2)}</td>
                  <td>${line.lineProfit.toFixed(2)}</td>
                  <td>{(line.lineMargin * 100).toFixed(2)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid4">
        <div className="metric-card"><div className="metric-label">Quoted Labor Revenue</div><div className="metric-value">${totals.quotedLaborRevenue.toFixed(2)}</div></div>
        <div className="metric-card"><div className="metric-label">Total Quoted Revenue</div><div className="metric-value">${totals.totalQuotedRevenue.toFixed(2)}</div></div>
        <div className="metric-card"><div className="metric-label">Actual Worker Payout Cost</div><div className="metric-value">${totals.actualLaborCost.toFixed(2)}</div></div>
        <div className="metric-card"><div className="metric-label">Other Actual Costs</div><div className="metric-value">${roundMoney(draft.actualTravel + draft.actualHotels + draft.actualPerDiem + draft.actualEquipment + draft.actualOtherCosts).toFixed(2)}</div></div>
        <div className="metric-card"><div className="metric-label">Total Actual Job Cost</div><div className="metric-value">${totals.totalActualJobCost.toFixed(2)}</div></div>
        <div className="metric-card"><div className="metric-label">Gross Profit</div><div className="metric-value">${totals.grossProfit.toFixed(2)}</div></div>
        <div className="metric-card"><div className="metric-label">Gross Margin</div><div className="metric-value">{(totals.grossMargin * 100).toFixed(2)}%</div></div>
        <div className="metric-card"><div className="metric-label">Margin Variance</div><div className="metric-value">{(totals.marginVariance * 100).toFixed(2)}%</div></div>
        <div className="metric-card"><div className="metric-label">Revenue Variance</div><div className="metric-value">${totals.revenueVariance.toFixed(2)}</div></div>
        <div className="metric-card"><div className="metric-label">Cost Variance</div><div className="metric-value">${totals.costVariance.toFixed(2)}</div></div>
      </div>
    </div>
  );
}
