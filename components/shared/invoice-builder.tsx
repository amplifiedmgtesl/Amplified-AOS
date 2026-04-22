
"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import {
  getActiveInvoice,
  loadClients,
  loadInvoiceDrafts,
  loadJobRequests,
  loadPositions,
  loadQuotes,
  loadSpecialties,
  pullApprovedTimesheetSummary,
  setActiveInvoice,
  upsertInvoiceDraft,
} from "@/lib/store/app-store";
import { getActiveRateCardProfileId, loadRateCardProfiles, loadRateRows } from "@/lib/rates/storage";
import type { Client, InvoiceDraft, JobRequest, Position, QuoteDraft, QuoteLine, Specialty } from "@/lib/store/types";
import type { RateRow } from "@/lib/rates/defaults";

type RateMode = "hourly" | "day";

type LineMeta = {
  date: string;
  department: string;
  position: string;
  shiftLabel: string;
  rateMode: RateMode;
  startTime: string;
  endTime: string;
};

function parseMinutes(value: string) {
  if (!value) return null;
  const t = value.trim().toUpperCase();
  const m = t.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/);
  if (!m) return null;
  let h = Number(m[1]);
  const mins = Number(m[2]);
  const mer = m[3];
  if (Number.isNaN(h) || Number.isNaN(mins)) return null;
  if (mer === "AM" && h === 12) h = 0;
  else if (mer === "PM" && h !== 12) h += 12;
  return h * 60 + mins;
}

function hoursBetween(start: string, end: string) {
  const s = parseMinutes(start);
  const e = parseMinutes(end);
  if (s == null || e == null) return 0;
  let diff = e - s;
  if (diff < 0) diff += 24 * 60;
  return Number((diff / 60).toFixed(2));
}

function parseOtTrigger(rule: string) {
  const m = (rule || "").match(/OT after\s+(\d+(\.\d+)?)/i);
  return m ? Number(m[1]) : 10;
}

function parseLineMeta(line: QuoteLine): LineMeta {
  const parts = (line.serviceKey || "").split(" | ");
  // 6-part legacy format: "date | dept | position | specialty | shift | rateMode"
  // 5-part legacy format: "date | dept | position | specialty | rateMode" (no shift)
  const has6 = parts.length >= 6;

  // Prefer discrete columns; fall back to service_key parse only when empty.
  const date = line.quoteDate || parts[0] || "";
  const department = line.department || parts[1] || "";
  const position = parts[2] || line.serviceKey || "";
  // Shift is only present in 6-part service_keys. If discrete column is empty
  // AND it's a 5-part key, don't pull parts[3] (that's specialty).
  const shiftLabel = line.shiftLabel || (has6 ? (parts[4] || "Shift 1") : "Shift 1");
  // rateMode is parts[5] in 6-part, parts[4] in 5-part.
  const rateModeRaw = (line.rateMode || (has6 ? parts[5] : parts[4]) || "hourly").toLowerCase();
  const rateMode = (rateModeRaw === "day" ? "day" : "hourly") as RateMode;

  const timePart = (line.rule || "").split(" | ")[0] || "";
  const times = timePart.split(" to ");
  return {
    date,
    department,
    position,
    shiftLabel,
    rateMode,
    startTime: line.startTime || times[0] || "",
    endTime: line.endTime || times[1] || "",
  };
}

function buildServiceKey(meta: LineMeta) {
  return [meta.date, meta.department, meta.position, meta.shiftLabel, meta.rateMode].join(" | ");
}

function buildRule(meta: LineMeta, line: QuoteLine) {
  const otTrigger = parseOtTrigger(line.rule || "");
  return `${meta.startTime || "-"} to ${meta.endTime || "-"} | ${meta.rateMode === "hourly" ? "Hourly" : "Day Rate"} | OT after ${otTrigger} / DT after 15`;
}

function recalcLineFromMeta(line: QuoteLine, meta: LineMeta): QuoteLine {
  const qty = Number(line.qty || 0);
  const hours = Number(line.hours || 0);
  const holidayHours = Number(line.holidayHours || 0);
  const travel = Number(line.travel || 0);
  const baseHourly = Number(line.baseHourly || 0);
  const baseDay = Number(line.baseDay || 0);
  const otRate = Number(line.otRate || 0);
  const dtRate = Number(line.dtRate || 0);
  const otTrigger = parseOtTrigger(line.rule || "");

  let total = 0;
  if (meta.rateMode === "hourly") {
    total = (qty * hours * baseHourly) + (holidayHours * dtRate) + travel;
  } else {
    const otHours = Math.max(0, Math.min(hours, 15) - otTrigger);
    const dtHours = Math.max(0, hours - 15);
    const perWorker = baseDay + (otHours * otRate) + (dtHours * dtRate);
    total = (qty * perWorker) + (holidayHours * dtRate) + travel;
  }

  return {
    ...line,
    serviceKey: buildServiceKey(meta),
    rule: buildRule(meta, line),
    total: Number(total.toFixed(2)),
  };
}

function recalcInvoice(invoice: InvoiceDraft): InvoiceDraft {
  const lines = invoice.lines.map((line) => {
    const meta = parseLineMeta(line);
    return recalcLineFromMeta(line, meta);
  });
  const subtotal = Number(lines.reduce((sum, line) => sum + Number(line.total || 0), 0).toFixed(2));
  const deposit = Number(invoice.deposit || 0);
  const amountDue = Number(Math.max(0, subtotal - deposit).toFixed(2));
  return { ...invoice, lines, subtotal, amountDue };
}

function buildDateOptions(quote: QuoteDraft | undefined, jobRequest: JobRequest | undefined) {
  const start = quote?.startDate || jobRequest?.requestDate || "";
  const end = quote?.endDate || jobRequest?.endDate || start;
  if (!start) return [];
  const out: string[] = [];
  const s = new Date(start + "T00:00:00");
  const e = new Date((end || start) + "T00:00:00");
  for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) out.push(d.toISOString().slice(0, 10));
  return out;
}

function findBestRateCardProfileId(clientId: string | undefined, client: string, preferredId?: string) {
  const profiles = loadRateCardProfiles();
  if (preferredId && profiles.find((p) => p.id === preferredId)) return preferredId;
  // Prefer match by clientId (FK) if available
  if (clientId) {
    const byClientId = profiles.find((p) => p.clientId === clientId);
    if (byClientId) return byClientId.id;
  }
  // Fall back to name match for legacy data
  const byClient = profiles.find((p) => p.clientName.trim().toLowerCase() === (client || "").trim().toLowerCase());
  if (byClient) return byClient.id;
  return getActiveRateCardProfileId() || profiles[0]?.id || "";
}

function getRateCardTerms(profileId: string) {
  const profile = loadRateCardProfiles().find((p) => p.id === profileId);
  return profile?.terms || "";
}

function timeOptions() {
  const out: string[] = [];
  for (let h = 0; h < 24; h++) {
    for (const m of [0, 30]) {
      const hh = String(((h + 11) % 12) + 1).padStart(2, "0");
      const mm = String(m).padStart(2, "0");
      const mer = h < 12 ? "AM" : "PM";
      out.push(`${hh}:${mm} ${mer}`);
    }
  }
  return out;
}

export default function InvoiceBuilder() {
  const [drafts, setDrafts] = useState<InvoiceDraft[]>([]);
  const [quotes, setQuotes] = useState<QuoteDraft[]>([]);
  const [jobRequests, setJobRequests] = useState<JobRequest[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  // Positions and specialties are read every render from the cache so they
  // reflect fetchAll completing after mount.
  const positions = loadPositions();
  const specialties = loadSpecialties();
  const [activeId, setActiveIdState] = useState<string>("");
  const [invoice, setInvoice] = useState<InvoiceDraft | null>(null);
  const [sourceQuoteId, setSourceQuoteId] = useState<string>("");
  const [sourceJobRequestId, setSourceJobRequestId] = useState<string>("");
  const [linkedRateCardProfileId, setLinkedRateCardProfileId] = useState<string>("");
  const [statusMsg, setStatusMsg] = useState("");
  const [syncingTimesheet, setSyncingTimesheet] = useState(false);
  const [invoiceLabel, setInvoiceLabel] = useState("");
  const [depositInvoiceMode, setDepositInvoiceMode] = useState(false);
  const rateRows = useMemo(() => loadRateRows(), []);
  const TIME_OPTIONS = useMemo(() => timeOptions(), []);

  useEffect(() => {
    const invoiceRows = loadInvoiceDrafts();
    const quoteRows = loadQuotes();
    const requestRows = loadJobRequests();
    setDrafts(invoiceRows);
    setQuotes(quoteRows);
    setJobRequests(requestRows);
    setClients(loadClients().filter((c) => c.isActive).sort((a, b) => a.name.localeCompare(b.name)));

    const active = getActiveInvoice() || invoiceRows[0]?.id || "";
    const found = invoiceRows.find((r) => r.id === active) || invoiceRows[0] || null;
    setActiveIdState(found?.id || "");
    setInvoice(found ? recalcInvoice(found) : null);
    setInvoiceLabel(found?.invoiceNo || "");
    setDepositInvoiceMode((found?.invoiceNo || "").endsWith("-DEP"));
    if (found) {
      setSourceQuoteId(found.quoteId || "");
      const linkedQuote = quoteRows.find((q) => q.id === found.quoteId);
      setSourceJobRequestId(linkedQuote?.linkedJobRequestId || "");
      setLinkedRateCardProfileId(found.rateCardProfileId || linkedQuote?.rateCardProfileId || findBestRateCardProfileId(found.clientId, found.client, linkedQuote?.rateCardProfileId));
      setActiveInvoice(found.id);
      setDepositInvoiceMode((found.invoiceNo || "").endsWith("-DEP"));
    }
  }, []);



function syncTermsFromLinkedRateCard(profileId?: string) {
  if (!invoice) return;
  const id = profileId || linkedRateCardProfileId || findBestRateCardProfileId(invoice.clientId, invoice.client, invoice.rateCardProfileId);
  const terms = getRateCardTerms(id);
  if (!terms) return;
  const next = { ...invoice, rateCardProfileId: id, terms };
  persist(next, "Invoice terms synced from linked rate card.");
  setLinkedRateCardProfileId(id);
}
  function persist(next: InvoiceDraft, message?: string) {
    const normalized = recalcInvoice(next);
    setInvoice(normalized);
    upsertInvoiceDraft(normalized);
    const nextDrafts = loadInvoiceDrafts();
    setDrafts(nextDrafts);
    setActiveIdState(normalized.id);
    setActiveInvoice(normalized.id);
    setInvoiceLabel(normalized.invoiceNo);
    setDepositInvoiceMode((normalized.invoiceNo || "").endsWith("-DEP"));
    if (message) setStatusMsg(message);
  }

  function chooseInvoice(id: string) {
    const found = loadInvoiceDrafts().find((r) => r.id === id) || null;
    setActiveIdState(id);
    setActiveInvoice(id);
    setInvoice(found ? recalcInvoice(found) : null);
    setInvoiceLabel(found?.invoiceNo || "");
    const quote = loadQuotes().find((q) => q.id === (found?.quoteId || ""));
    setSourceQuoteId(found?.quoteId || "");
    setSourceJobRequestId(quote?.linkedJobRequestId || "");
    setLinkedRateCardProfileId(found?.rateCardProfileId || quote?.rateCardProfileId || findBestRateCardProfileId(found?.clientId, found?.client || "", quote?.rateCardProfileId));
  }

  function patch(p: Partial<InvoiceDraft>) {
    if (!invoice) return;
    persist({ ...invoice, ...p });
  }

  function patchLine(index: number, linePatch: Partial<QuoteLine>, metaPatch?: Partial<LineMeta>) {
    if (!invoice) return;
    const nextLines = invoice.lines.map((line, idx) => {
      if (idx !== index) return line;
      const nextLine = { ...line, ...linePatch };
      const nextMeta = { ...parseLineMeta(nextLine), ...(metaPatch || {}) };
      if ((metaPatch?.startTime || metaPatch?.endTime) && nextMeta.startTime && nextMeta.endTime) {
        nextLine.hours = hoursBetween(nextMeta.startTime, nextMeta.endTime);
      }
      return recalcLineFromMeta(nextLine, nextMeta);
    });
    persist({ ...invoice, lines: nextLines });
  }

  function fillLineFromRateCard(index: number, position: string) {
    if (!invoice) return;
    const row = rateRows.find((r) => `${r.department} | ${r.specialty}` === position);
    if (!row) return;
    const existing = invoice.lines[index];
    const meta = { ...parseLineMeta(existing), department: row.department, position };
    patchLine(index, {
      baseHourly: row.hourly,
      baseDay: row.day,
      otRate: row.otRate,
      dtRate: row.dtRate,
      serviceKey: buildServiceKey(meta),
    }, meta);
  }

  // Pick position: set positionId + default first specialty (FK-driven path)
  function setLinePosition(index: number, newPositionId: string) {
    if (!invoice) return;
    const pos = positions.find((p) => p.id === newPositionId);
    const firstSpc = specialtiesForPositionId(newPositionId)[0];
    const row = rateRows.find((r) => r.specialtyId === firstSpc?.id);
    const existing = invoice.lines[index];
    const meta = {
      ...parseLineMeta(existing),
      department: pos?.name ?? "",
      position: firstSpc ? `${pos?.name ?? ""} | ${firstSpc.name}` : pos?.name ?? "",
    };
    patchLine(index, {
      positionId: newPositionId,
      specialtyId: firstSpc?.id ?? undefined,
      department: pos?.name ?? "",
      specialty: firstSpc?.name ?? "",
      baseHourly: row?.hourly ?? existing.baseHourly,
      baseDay:    row?.day    ?? existing.baseDay,
      otRate:     row?.otRate ?? existing.otRate,
      dtRate:     row?.dtRate ?? existing.dtRate,
      travel:     row?.travel ?? existing.travel,
      serviceKey: buildServiceKey(meta),
    }, meta);
  }

  function setLineSpecialty(index: number, newSpecialtyId: string) {
    if (!invoice) return;
    const spc = specialties.find((s) => s.id === newSpecialtyId);
    const pos = spc ? positions.find((p) => p.id === spc.positionId) : undefined;
    const row = rateRows.find((r) => r.specialtyId === newSpecialtyId);
    const existing = invoice.lines[index];
    const existingMeta = parseLineMeta(existing);
    const meta = {
      ...existingMeta,
      department: pos?.name ?? existing.department ?? "",
      position: pos && spc ? `${pos.name} | ${spc.name}` : existingMeta.position,
    };
    patchLine(index, {
      specialtyId: newSpecialtyId,
      specialty: spc?.name ?? "",
      baseHourly: row?.hourly ?? existing.baseHourly,
      baseDay:    row?.day    ?? existing.baseDay,
      otRate:     row?.otRate ?? existing.otRate,
      dtRate:     row?.dtRate ?? existing.dtRate,
      travel:     row?.travel ?? existing.travel,
      serviceKey: buildServiceKey(meta),
    }, meta);
  }

  function syncFromQuote(quoteId: string) {
    if (!invoice || !quoteId) return;
    const quote = quotes.find((q) => q.id === quoteId);
    if (!quote) return;
    const req = jobRequests.find((r) => r.id === quote.linkedJobRequestId);
    const rateCardProfileId = findBestRateCardProfileId(quote.clientId, quote.client, quote.rateCardProfileId);
    const syncedTerms = getRateCardTerms(rateCardProfileId) || quote.terms;
    const next: InvoiceDraft = {
      ...invoice,
      quoteId: quote.id,
      billTo: quote.client,
      clientId: quote.clientId,
      client: quote.client,
      eventName: quote.eventName,
      venue: quote.venue,
      cityState: quote.cityState,
      lines: quote.lines.map((line) => ({ ...line })),
      subtotal: quote.total,
      deposit: quote.deposit,
      amountDue: Math.max(0, quote.total - quote.deposit),
      terms: syncedTerms,
      rateCardProfileId: rateCardProfileId,
      notes: [
        req?.notes ? `Job Request Notes:\n${req.notes}` : "",
        req?.packetNotes ? `\nPacket Notes:\n${req.packetNotes}` : "",
        quote.notes ? `\nQuote Notes:\n${quote.notes}` : "",
      ].filter(Boolean).join("\n"),
      linkedJobSheetId: quote.linkedJobSheetId,
      timesheetSummary: quote.timesheetSummary,
    };
    persist(next, "Invoice synced from saved quote.");
    setSourceQuoteId(quote.id);
    setSourceJobRequestId(quote.linkedJobRequestId || "");
    setLinkedRateCardProfileId(rateCardProfileId);
    setLinkedRateCardProfileId(rateCardProfileId);
  }

  function syncFromJobRequest(jobRequestId: string) {
    if (!invoice || !jobRequestId) return;
    const req = jobRequests.find((r) => r.id === jobRequestId);
    if (!req) return;
    const rateCardProfileId = findBestRateCardProfileId(req.clientId, req.client);
    const syncedTerms = getRateCardTerms(rateCardProfileId) || invoice.terms;
    const next: InvoiceDraft = {
      ...invoice,
      billTo: req.client,
      clientId: req.clientId,
      client: req.client,
      eventName: req.eventName,
      venue: req.venue,
      cityState: req.cityState,
      terms: syncedTerms,
      rateCardProfileId: rateCardProfileId,
      notes: [
        req.notes ? `Job Request Notes:\n${req.notes}` : "",
        req.packetNotes ? `\nPacket Notes:\n${req.packetNotes}` : "",
      ].filter(Boolean).join("\n"),
    };
    persist(next, "Invoice synced from saved job request.");
    setSourceJobRequestId(req.id);
    setLinkedRateCardProfileId(rateCardProfileId);
  }

  async function syncLaborActuals() {
    if (!invoice) return;
    const jobSheetId = invoice.linkedJobSheetId;
    if (!jobSheetId) { setStatusMsg("No linked job sheet — sync a quote first."); return; }
    setSyncingTimesheet(true);
    setStatusMsg("");
    const summary = await pullApprovedTimesheetSummary(jobSheetId);
    setSyncingTimesheet(false);
    if (summary.length === 0) {
      setStatusMsg("No approved timesheet entries found for this job sheet.");
      return;
    }
    persist({ ...invoice, timesheetSummary: summary }, `Labor actuals pulled — ${summary.length} position${summary.length !== 1 ? "s" : ""} from approved entries.`);
  }

  function saveInvoiceDraftNow() {
    if (!invoice) return;
    persist({ ...invoice, invoiceNo: invoice.invoiceNo || invoiceLabel || invoice.invoiceNo }, "Invoice saved.");
  }



function createDepositInvoiceDraft() {
  if (!invoice) return;
  const newId = `inv-deposit-${Date.now()}`;
  const depositAmount = Number(invoice.deposit || 0);
  const next: InvoiceDraft = {
    ...invoice,
    id: newId,
    invoiceNo: `${invoice.invoiceNo}-DEP`,
    lines: [],
    subtotal: 0,
    amountDue: depositAmount,
    paidAmount: 0,
    notes: [invoice.notes, "Deposit invoice generated from original invoice draft."].filter(Boolean).join("\n\n"),
    status: "draft",
  };
  upsertInvoiceDraft(next);
  const rows = loadInvoiceDrafts();
  setDrafts(rows);
  setActiveIdState(newId);
  setActiveInvoice(newId);
  setInvoice(next);
  setInvoiceLabel(next.invoiceNo);
  setDepositInvoiceMode(true);
  setStatusMsg("Separate deposit invoice draft created.");
}

  function saveAsNewDraft() {
    if (!invoice) return;
    const newId = `inv-${Date.now()}`;
    const next = { ...invoice, id: newId, invoiceNo: invoiceLabel || `${invoice.invoiceNo}-copy` };
    persist(next, "Saved as new invoice draft.");
  }

  const activeQuote = useMemo(() => quotes.find((q) => q.id === sourceQuoteId), [quotes, sourceQuoteId]);
  const activeJobRequest = useMemo(() => jobRequests.find((r) => r.id === sourceJobRequestId), [jobRequests, sourceJobRequestId]);
  const dateOptions = useMemo(() => buildDateOptions(activeQuote, activeJobRequest), [activeQuote, activeJobRequest]);
  const positionOptions = useMemo(() => rateRows.map((r) => `${r.department} | ${r.specialty}`), [rateRows]);

  // Positions that the current rate card has rates for, PLUS any position
  // currently referenced by a line on this invoice (so existing values display
  // even if the working rate card doesn't include them).
  const availablePositions = useMemo(() => {
    const posIds = new Set<string>();
    for (const row of rateRows) {
      const pos = positions.find((p) => p.name === row.position);
      if (pos) posIds.add(pos.id);
    }
    if (invoice) {
      for (const line of invoice.lines) {
        if (line.positionId) posIds.add(line.positionId);
      }
    }
    return positions.filter((p) => posIds.has(p.id)).sort((a, b) => a.sortOrder - b.sortOrder);
  }, [rateRows, positions, invoice]);

  const specialtiesForPositionId = (positionId: string): Specialty[] => {
    if (!positionId) return [];
    const rateSpecialtyIds = new Set(rateRows.map((r) => r.specialtyId).filter(Boolean) as string[]);
    // Also include any specialty currently referenced by a line on this invoice.
    if (invoice) {
      for (const line of invoice.lines) {
        if (line.specialtyId) rateSpecialtyIds.add(line.specialtyId);
      }
    }
    return specialties
      .filter((s) => s.positionId === positionId && rateSpecialtyIds.has(s.id))
      .sort((a, b) => a.sortOrder - b.sortOrder);
  };

  // Resolve IDs for a line (fallback for pre-migration rows saved with only
  // text or service_key).
  const resolveLineIds = (line: QuoteLine): { positionId: string; specialtyId: string; positionName: string; specialtyName: string } => {
    let positionId = line.positionId || "";
    let specialtyId = line.specialtyId || "";
    let deptText = (line.department || "").trim().toLowerCase();
    let spcText = (line.specialty || "").trim().toLowerCase();

    // Fallback: parse service_key when discrete text columns are empty.
    // Legacy 5-part format: "date | department | position | specialty | rateMode"
    // Legacy 6-part format: "date | department | position | specialty | shiftLabel | rateMode"
    if (!deptText || !spcText) {
      const parts = (line.serviceKey || "").split(" | ");
      if (parts.length >= 5) {
        if (!deptText) deptText = (parts[1] || "").trim().toLowerCase();
        if (!spcText) spcText  = (parts[3] || "").trim().toLowerCase();
      }
    }

    if (!positionId && deptText) {
      const pos = positions.find((p) => p.name.toLowerCase().trim() === deptText);
      if (pos) positionId = pos.id;
    }
    if (!specialtyId && positionId && spcText) {
      const spc = specialties.find((s) => s.positionId === positionId && s.name.toLowerCase().trim() === spcText);
      if (spc) specialtyId = spc.id;
    }
    const posName = positions.find((p) => p.id === positionId)?.name ?? line.department ?? "";
    const spcName = specialties.find((s) => s.id === specialtyId)?.name ?? line.specialty ?? "";
    return { positionId, specialtyId, positionName: posName, specialtyName: spcName };
  };
  const balance = useMemo(() => !invoice ? 0 : Math.max(0, Number(invoice.amountDue || 0) - Number(invoice.paidAmount || 0)), [invoice]);

  if (!invoice) {
    return (
      <div className="card">
        <h2 className="section-title">Invoices</h2>
        <p className="muted">No invoice drafts yet. Create one from the Quote Builder using Save Invoice Draft.</p>
      </div>
    );
  }

  return (
    <div className="grid">
      <div className="card hide-print">
        <h2 className="section-title">Invoice Control Center</h2>

        {/* Top action bar — save/copy/print */}
        <div className="action-row" style={{ marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
          <button type="button" className="secondary" onClick={saveInvoiceDraftNow}>Save Invoice</button>
          <button type="button" className="secondary" onClick={saveAsNewDraft}>Save As New Draft</button>
          <button type="button" className="secondary" onClick={createDepositInvoiceDraft}>Create Deposit Invoice Draft</button>
          <button onClick={() => window.print()}>Download / Print Invoice PDF</button>
        </div>

        <div className="grid4">
          {/* Row 1 — invoice identity */}
          <div>
            <small>Open Saved Invoice / Draft</small>
            <select value={activeId} onChange={(e) => chooseInvoice(e.target.value)}>
              {drafts.map((d) => <option key={d.id} value={d.id}>{d.invoiceNo} — {d.client}</option>)}
            </select>
          </div>
          <div><small>Invoice Number</small><input value={invoice.invoiceNo} onChange={(e) => patch({ invoiceNo: e.target.value })} /></div>
          <div><small>Status</small><select value={invoice.status} onChange={(e) => patch({ status: e.target.value })}><option value="draft">draft</option><option value="sent">sent</option><option value="partial">partial</option><option value="paid">paid</option></select></div>
          <div><small>Invoice View</small><select value={depositInvoiceMode ? "deposit" : "standard"} onChange={(e) => setDepositInvoiceMode(e.target.value === "deposit")}><option value="standard">Standard</option><option value="deposit">Deposit Only</option></select></div>

          {/* Row 2 — client + event */}
          <div>
            <small>Client</small>
            <select
              value={invoice.clientId ?? ""}
              onChange={(e) => {
                const c = clients.find((x) => x.id === e.target.value);
                patch({ clientId: c?.id, client: c?.name ?? "", billTo: c?.name ?? "" });
              }}
            >
              <option value="">— select client —</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>{c.code ? `[${c.code}] ${c.name}` : c.name}</option>
              ))}
            </select>
          </div>
          <div>
            <small>Client Billing Address</small>
            {(() => {
              const c = clients.find((x) => x.id === invoice.clientId);
              if (!c) return <div style={{ color: "#888", fontSize: 12, padding: "6px 8px", border: "1px solid var(--border, #e5e7eb)", borderRadius: 4, background: "#f9fafb", minHeight: 62 }}>Select a client.</div>;
              const cityLine = [c.city, c.state].filter(Boolean).join(", ") + (c.zip ? ` ${c.zip}` : "");
              return (
                <div style={{ fontSize: 12, padding: "6px 8px", border: "1px solid var(--border, #e5e7eb)", borderRadius: 4, background: "#f9fafb", minHeight: 62 }}>
                  <div style={{ fontWeight: 600 }}>{c.name}</div>
                  {c.address && <div style={{ color: "#555" }}>{c.address}</div>}
                  {cityLine && <div style={{ color: "#555" }}>{cityLine}</div>}
                  {!c.address && !cityLine && <div style={{ color: "#888", fontStyle: "italic" }}>No address on file.</div>}
                </div>
              );
            })()}
          </div>
          <div><small>Event Name</small><input value={invoice.eventName} onChange={(e) => patch({ eventName: e.target.value })} /></div>
          <div><small>Venue</small><input value={invoice.venue} onChange={(e) => patch({ venue: e.target.value })} /></div>

          {/* Row 3 — dates + po */}
          <div><small>City / State</small><input value={invoice.cityState} onChange={(e) => patch({ cityState: e.target.value })} /></div>
          <div><small>Issue Date</small><input type="date" value={invoice.issueDate} onChange={(e) => patch({ issueDate: e.target.value })} /></div>
          <div><small>Due Date</small><input type="date" value={invoice.dueDate} onChange={(e) => patch({ dueDate: e.target.value })} /></div>
          <div><small>PO No.</small><input value={invoice.poNo} onChange={(e) => patch({ poNo: e.target.value })} /></div>

          {/* Row 4 — linked source dropdowns */}
          <div>
            <small>Linked Rate Card</small>
            <select value={linkedRateCardProfileId} disabled={!invoice.clientId} onChange={(e) => setLinkedRateCardProfileId(e.target.value)}>
              <option value="">{invoice.clientId ? "None" : "— Select a client first —"}</option>
              {invoice.clientId && loadRateCardProfiles().filter((p) => p.clientId === invoice.clientId).map((p) => <option key={p.id} value={p.id}>{p.name || p.clientName}</option>)}
            </select>
          </div>
          <div>
            <small>Link Saved Quote</small>
            <select value={sourceQuoteId} disabled={!invoice.clientId} onChange={(e) => setSourceQuoteId(e.target.value)}>
              <option value="">{invoice.clientId ? "None" : "— Select a client first —"}</option>
              {invoice.clientId && quotes.filter((q) => q.clientId === invoice.clientId).map((q) => <option key={q.id} value={q.id}>{q.client} — {q.eventName}</option>)}
            </select>
          </div>
          <div>
            <small>Link Job Request</small>
            <select value={sourceJobRequestId} disabled={!invoice.clientId} onChange={(e) => setSourceJobRequestId(e.target.value)}>
              <option value="">{invoice.clientId ? "None" : "— Select a client first —"}</option>
              {invoice.clientId && jobRequests.filter((r) => r.clientId === invoice.clientId).map((r) => <option key={r.id} value={r.id}>{r.client} — {r.eventName}</option>)}
            </select>
          </div>
          <div></div>

          {/* Row 5 — money */}
          <div><small>Deposit</small><input type="number" value={invoice.deposit} onChange={(e) => patch({ deposit: Number(e.target.value || 0) })} /></div>
          <div><small>Paid Amount</small><input type="number" value={invoice.paidAmount} onChange={(e) => patch({ paidAmount: Number(e.target.value || 0) })} /></div>
        </div>

        {statusMsg ? <div className="badge" style={{ marginTop: 12 }}>{statusMsg}</div> : null}

        <div style={{ marginTop: 12 }}>
          <small>Invoice Notes</small>
          <textarea value={invoice.notes} onChange={(e) => patch({ notes: e.target.value })} />
        </div>

        {/* Bottom action bar — all sync/pull operations grouped */}
        <div className="action-row" style={{ marginTop: 12, flexWrap: "wrap", gap: 8 }}>
          <button type="button" className="secondary" onClick={() => syncFromQuote(sourceQuoteId)} disabled={!sourceQuoteId}>Sync From Quote</button>
          <button type="button" className="secondary" onClick={() => syncFromJobRequest(sourceJobRequestId)} disabled={!sourceJobRequestId}>Sync From Job Request</button>
          <button type="button" className="secondary" onClick={() => syncTermsFromLinkedRateCard()} disabled={!linkedRateCardProfileId}>Sync Terms From Linked Rate Card</button>
          <button
            type="button"
            className="secondary"
            onClick={syncLaborActuals}
            disabled={syncingTimesheet || !invoice?.linkedJobSheetId}
            title={invoice?.linkedJobSheetId ? "Pull approved timesheet entries grouped by position" : "Link a quote with a job sheet first"}
          >
            {syncingTimesheet ? "Pulling…" : "⟳ Pull Labor Actuals from Timesheet"}
          </button>
          {invoice?.linkedJobSheetId && (
            <span className="muted" style={{ fontSize: 11, alignSelf: "center" }}>Job sheet: {invoice.linkedJobSheetId}</span>
          )}
        </div>
      </div>

      <div className="invoice-shell">
        <div className="pdf-header">
          <div></div>
          <div className="pdf-title-wrap">
            <div className="pdf-logo-wrap"><img src="/branding/client-logo.png?v=2" alt="Company logo" className="pdf-logo" /></div>
            <h2 className="pdf-title">Invoice</h2>
            <div className="pdf-subtitle">Amplified Event Solutions</div>
          </div>
          <div></div>
        </div>

        <div className="invoice-top">
          <div className="invoice-box">
            <h3 className="section-title">Bill To</h3>
            <div><strong>{invoice.billTo || invoice.client}</strong></div>
            <div className="muted">{invoice.eventName}</div>
            <div className="muted">{invoice.venue}</div>
            <div className="muted">{invoice.cityState}</div>
          </div>

          <div className="invoice-box">
            <div className="invoice-number">{invoice.invoiceNo}</div>
            <table>
              <tbody>
                <tr><td><strong>Issue Date</strong></td><td>{invoice.issueDate}</td></tr>
                <tr><td><strong>Due Date</strong></td><td>{invoice.dueDate}</td></tr>
                <tr><td><strong>Status</strong></td><td>{invoice.status}</td></tr>
                <tr><td><strong>PO No.</strong></td><td>{invoice.poNo || "-"}</td></tr>
                <tr><td><strong>Saved Quote</strong></td><td>{sourceQuoteId || "-"}</td></tr>
                <tr><td><strong>Job Request</strong></td><td>{sourceJobRequestId || "-"}</td></tr>
                <tr><td><strong>Rate Card</strong></td><td>{linkedRateCardProfileId || invoice.rateCardProfileId || "-"}</td></tr>
              </tbody>
            </table>
          </div>
        </div>

        <div className="total-card" style={{ marginTop: 12 }}>
          <table>
            <tbody>
              {!depositInvoiceMode ? (
                <>
                  <tr><td><strong>Subtotal</strong></td><td>${invoice.subtotal.toFixed(2)}</td></tr>
                  <tr><td><strong>Deposit</strong></td><td>${invoice.deposit.toFixed(2)}</td></tr>
                  <tr><td><strong>Amount Due</strong></td><td>${invoice.amountDue.toFixed(2)}</td></tr>
                  <tr><td><strong>Paid</strong></td><td>${invoice.paidAmount.toFixed(2)}</td></tr>
                  <tr><td><strong>Balance</strong></td><td>${balance.toFixed(2)}</td></tr>
                </>
              ) : (
                <>
                  <tr><td><strong>Total</strong></td><td>${invoice.deposit.toFixed(2)}</td></tr>
                  <tr><td><strong>Deposit</strong></td><td>${invoice.deposit.toFixed(2)}</td></tr>
                </>
              )}
            </tbody>
          </table>
        </div>

        {!depositInvoiceMode ? (
        <div style={{ overflowX: "auto" }}>
          <table className="line-table">
            <thead>
              <tr>
                <th>Start Date</th>
                <th className="hide-print">End Date</th>
                <th colSpan={2}>Position</th>
                <th colSpan={2}>Specialty</th>
                <th>Shift</th>
                <th>Mode</th>
              </tr>
              <tr>
                <th>Start</th>
                <th>End</th>
                <th>Qty</th>
                <th>Hours</th>
                <th>Hr Rate</th>
                <th>Day Rate</th>
                <th>Travel</th>
                <th>Line Total</th>
              </tr>
            </thead>
            <tbody>
              {invoice.lines.map((line, idx) => {
                const meta = parseLineMeta(line);
                const ids = resolveLineIds(line);
                const lineEndDate = line.endDate || meta.date || "";
                const band = `line-band-${idx % 4}`;
                return (
                  <Fragment key={idx}>
                    <tr className={`line-row ${band}`}>
                      <td>
                        <div className="hide-print">
                          <select value={meta.date} onChange={(e) => {
                            const newStart = e.target.value;
                            const curEnd = line.endDate || meta.date || "";
                            const newEnd = (!curEnd || curEnd < newStart) ? newStart : curEnd;
                            patchLine(idx, { endDate: newEnd }, { ...meta, date: newStart });
                          }}>
                            <option value="">Select Date</option>
                            {dateOptions.map((d) => <option key={d} value={d}>{d}</option>)}
                          </select>
                        </div>
                        <div className="print-terms">
                          {lineEndDate && lineEndDate !== meta.date ? `${meta.date || "-"} → ${lineEndDate}` : (meta.date || "-")}
                        </div>
                      </td>
                      <td className="hide-print">
                        <select value={line.endDate || meta.date || ""} onChange={(e) => patchLine(idx, { endDate: e.target.value })}>
                          <option value="">Select Date</option>
                          {dateOptions.map((d) => <option key={d} value={d}>{d}</option>)}
                        </select>
                      </td>
                      <td colSpan={2}>
                        <div className="hide-print">
                          <select value={ids.positionId} onChange={(e) => setLinePosition(idx, e.target.value)}>
                            <option value="">— Select Position —</option>
                            {availablePositions.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                          </select>
                        </div>
                        <div className="print-terms">{ids.positionName || "-"}</div>
                      </td>
                      <td colSpan={2}>
                        <div className="hide-print">
                          <select value={ids.specialtyId} onChange={(e) => setLineSpecialty(idx, e.target.value)}>
                            <option value="">— Select Specialty —</option>
                            {specialtiesForPositionId(ids.positionId).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                          </select>
                        </div>
                        <div className="print-terms">{ids.specialtyName || "-"}</div>
                      </td>
                      <td>
                        <div className="hide-print"><input value={meta.shiftLabel} onChange={(e) => patchLine(idx, {}, { ...meta, shiftLabel: e.target.value })} /></div>
                        <div className="print-terms">{meta.shiftLabel}</div>
                      </td>
                      <td>
                        <div className="hide-print">
                          <select value={meta.rateMode} onChange={(e) => patchLine(idx, {}, { ...meta, rateMode: e.target.value as RateMode })}>
                            <option value="hourly">Hourly</option>
                            <option value="day">Day Rate</option>
                          </select>
                        </div>
                        <div className="print-terms">{meta.rateMode === "hourly" ? "Hourly" : "Day Rate"}</div>
                      </td>
                    </tr>
                    <tr className={`line-row line-row-end ${band}`}>
                      <td>
                        <div className="hide-print">
                          <select value={meta.startTime} onChange={(e) => patchLine(idx, {}, { ...meta, startTime: e.target.value })}>
                            <option value="">Start</option>
                            {TIME_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
                          </select>
                        </div>
                        <div className="print-terms">{meta.startTime || "-"}</div>
                      </td>
                      <td>
                        <div className="hide-print">
                          <select value={meta.endTime} onChange={(e) => patchLine(idx, {}, { ...meta, endTime: e.target.value })}>
                            <option value="">End</option>
                            {TIME_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
                          </select>
                        </div>
                        <div className="print-terms">{meta.endTime || "-"}</div>
                      </td>
                      <td>
                        <div className="hide-print"><input type="number" value={line.qty} onChange={(e) => patchLine(idx, { qty: Number(e.target.value || 0) })} /></div>
                        <div className="print-terms">{line.qty}</div>
                      </td>
                      <td>
                        <div className="hide-print"><input type="number" value={line.hours} onChange={(e) => patchLine(idx, { hours: Number(e.target.value || 0) })} /></div>
                        <div className="print-terms">{line.hours}</div>
                      </td>
                      <td>
                        <div className="hide-print"><input type="number" value={line.baseHourly} onChange={(e) => patchLine(idx, { baseHourly: Number(e.target.value || 0) })} /></div>
                        <div className="print-terms">{line.baseHourly != null ? `$${line.baseHourly.toFixed(2)}` : "-"}</div>
                      </td>
                      <td>
                        <div className="hide-print"><input type="number" value={line.baseDay} onChange={(e) => patchLine(idx, { baseDay: Number(e.target.value || 0) })} /></div>
                        <div className="print-terms">{line.baseDay != null ? `$${line.baseDay.toFixed(2)}` : "-"}</div>
                      </td>
                      <td>
                        <div className="hide-print"><input type="number" value={line.travel} onChange={(e) => patchLine(idx, { travel: Number(e.target.value || 0) })} /></div>
                        <div className="print-terms">{line.travel ? `$${line.travel.toFixed(2)}` : "-"}</div>
                      </td>
                      <td>${Number(line.total || 0).toFixed(2)}</td>
                    </tr>
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        ) : (
        <div className="invoice-box" style={{ marginTop: 12 }}>
          <h3 className="section-title">Deposit Invoice</h3>
          <div className="muted">This deposit invoice references the linked quote/job data and bills the deposit amount only.</div>
        </div>
        )}

        {!depositInvoiceMode && invoice.timesheetSummary && invoice.timesheetSummary.length > 0 ? (
          <div style={{ marginTop: 18 }}>
            <h3 className="section-title">Detailed Labor Breakdown from Timekeeping</h3>
            <div style={{ overflowX: "auto" }}>
              <table>
                <thead><tr><th>Position</th><th>Workers</th><th>STD Hours</th><th>OT Hours</th><th>DT Hours</th><th>Total Hours</th><th>Total Labor Pay</th></tr></thead>
                <tbody>{invoice.timesheetSummary.map((r) => <tr key={r.position}><td>{r.position}</td><td>{r.workers}</td><td>{r.stdHours.toFixed(2)}</td><td>{r.otHours.toFixed(2)}</td><td>{r.dtHours.toFixed(2)}</td><td>{r.totalHours.toFixed(2)}</td><td>${r.totalPay.toFixed(2)}</td></tr>)}</tbody>
              </table>
            </div>
          </div>
        ) : null}

        <div className="invoice-box" style={{ marginTop: 18 }}>
          <h3 className="section-title">Terms & Notes</h3>
          <div style={{ whiteSpace: "pre-line", lineHeight: 1.35, fontSize: 13 }}>{invoice.terms}</div>
          {invoice.notes ? (
            <div style={{ marginTop: 12, whiteSpace: "pre-line", lineHeight: 1.35, fontSize: 13 }}>
              <strong>Notes:</strong>
              {"\n"}
              {invoice.notes}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
