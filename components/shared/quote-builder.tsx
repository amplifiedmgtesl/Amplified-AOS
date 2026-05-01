
"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { printWithTitle } from "@/lib/print-with-title";
import { DEFAULT_RATE_ROWS, type RateRow } from "@/lib/rates/defaults";
import { computeDayHourSplit, formatOtTriggerRule, triggerToKind } from "@/lib/rates/ot-trigger";
import { getActiveRateCardProfileId, loadClientName, loadProfileIntoCurrent, loadRateCardProfiles, loadRateRows, loadTerms } from "@/lib/rates/storage";
import { supabase } from "@/lib/supabase/client";
import {
  getActiveQuote,
  getActiveQuoteDraft,
  getQuoteSeed,
  loadInvoiceDrafts,
  loadJobRequests,
  loadJobSheets,
  loadPositions,
  loadQuoteDraftWorkspaces,
  loadQuotes,
  loadSpecialties,
  getTimesheetByJobSheetId,
  setActiveInvoice,
  setActiveQuote,
  setActiveQuoteDraft,
  setQuoteSeed,
  upsertInvoiceDraft,
  upsertQuote,
  upsertQuoteDraftWorkspace,
} from "@/lib/store/app-store";
import { summarizeTimesheet } from "@/lib/store/timekeeping";
import type { InvoiceDraft, Position, QuoteDraft, QuoteLine, Specialty } from "@/lib/store/types";

type RateMode = "hourly" | "day";

type Line = {
  id:number;
  positionId:string;
  specialtyId:string;
  // Legacy snapshot fields — populated on save for DB, not used for primary UI lookup anymore.
  department:string;
  position:string;
  specialty:string;
  quoteDate:string;    // start date
  endDate:string;      // end date (defaults to same as quoteDate; advance for multi-day / cross-midnight lines)
  shiftLabel:string;
  startTime:string;
  endTime:string;
  qty:number;
  rateMode: RateMode;
  holidayHours:number;
  travel:number;
};

type DayDetail = { id:number; date:string; defaultStartTime:string; defaultEndTime:string; expectedHours:number; };

type DraftState = {
  quoteId:string;
  clientId:string;
  client:string;
  eventName:string;
  venue:string;
  cityState:string;
  startDate:string;
  endDate:string;
  defaultStartTime:string;
  defaultEndTime:string;
  expectedHoursPerDay:number;
  depositPct:number;
  terms:string;
  linkedJobRequestId:string;
  linkedJobSheetId:string;
  signatureName:string;
  signedAt:string;
  activeRateCardProfileId:string;
  lines:Line[];
  dayDetails:DayDetail[];
};

function rowKey(row: RateRow) { return `${row.department} | ${row.specialty}`; }

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
  return +(diff / 60).toFixed(2);
}

function calcLineTotal(hours:number, holidayHours:number, qty:number, row: RateRow, travel:number, rateMode: RateMode) {
  const hrs = Math.max(0, hours);
  if (rateMode === "hourly") {
    return +((qty * hrs * row.hourly) + (holidayHours * row.dtRate) + travel).toFixed(2);
  }
  const split = computeDayHourSplit(hrs, triggerToKind(row.dtAfter));
  const base = row.day + (split.ot * row.otRate) + (split.dt * row.dtRate);
  return +((qty * base) + (holidayHours * row.dtRate) + travel).toFixed(2);
}

function daysInclusive(start: string, end: string) {
  if (!start) return [];
  const s = new Date(start + "T00:00:00");
  const e = new Date((end || start) + "T00:00:00");
  const out: string[] = [];
  for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) out.push(d.toISOString().slice(0,10));
  return out;
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

function normalizeTimeInput(value: string) {
  if (!value) return "";
  if (value.includes("AM") || value.includes("PM")) return value;
  const parts = value.split(":").map(Number);
  if (parts.length < 2 || Number.isNaN(parts[0]) || Number.isNaN(parts[1])) return value;
  const h = parts[0];
  const m = parts[1];
  const hh = String(((h + 11) % 12) + 1).padStart(2, "0");
  const mm = String(m).padStart(2, "0");
  const mer = h < 12 ? "AM" : "PM";
  return `${hh}:${mm} ${mer}`;
}

export default function QuoteBuilder() {
  const [quoteId, setQuoteId] = useState("");
  const [clientId, setClientId] = useState("");
  const [client, setClient] = useState("");
  const [clientsList, setClientsList] = useState<{ id: string; name: string }[]>([]);
  const [eventName, setEventName] = useState("");
  const [venue, setVenue] = useState("");
  const [cityState, setCityState] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [defaultStartTime, setDefaultStartTime] = useState("");
  const [defaultEndTime, setDefaultEndTime] = useState("");
  const [expectedHoursPerDay, setExpectedHoursPerDay] = useState(10);
  const [depositPct, setDepositPct] = useState(50);
  const [rows, setRows] = useState<RateRow[]>(DEFAULT_RATE_ROWS);
  const [terms, setTerms] = useState("");
  const [statusMsg, setStatusMsg] = useState("");
  const [linkedJobRequestId, setLinkedJobRequestId] = useState("");
  const [linkedJobSheetId, setLinkedJobSheetId] = useState("");
  const [signatureName, setSignatureName] = useState("");
  const [preparedByName, setPreparedByName] = useState("");
  const [preparedByTitle, setPreparedByTitle] = useState("");
  const [signedAt, setSignedAt] = useState("");
  const [activeSavedQuoteId, setActiveSavedQuoteId] = useState("");
  const [activeRateCardProfileId, setActiveRateCardProfileIdState] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [dayDetails, setDayDetails] = useState<DayDetail[]>([]);
  const [draftName, setDraftName] = useState("Working Draft");
  const [activeDraftId, setActiveDraftIdState] = useState("");
  const [draftTick, setDraftTick] = useState(0);

  const jobSheets = loadJobSheets();
  const jobRequests = loadJobRequests();
  const savedQuotes = loadQuotes();
  const rateCardProfiles = loadRateCardProfiles();
  const positions = loadPositions();
  const specialties = loadSpecialties();
  const linkedTimesheet = linkedJobSheetId ? getTimesheetByJobSheetId(linkedJobSheetId) : null;
  const timeSummary = useMemo(() => summarizeTimesheet(linkedTimesheet), [linkedJobSheetId, linkedTimesheet?.rows?.length]);

  // Positions that the current rate card has rates for, PLUS any position
  // currently referenced by a line on this quote (so existing values display
  // even if the working rate card doesn't include them).
  const availablePositions = useMemo(() => {
    const posIds = new Set<string>();
    for (const row of rows) {
      const pos = positions.find((p) => p.name === row.position);
      if (pos) posIds.add(pos.id);
    }
    for (const line of lines) {
      if (line.positionId) posIds.add(line.positionId);
    }
    return positions.filter((p) => posIds.has(p.id)).sort((a, b) => a.sortOrder - b.sortOrder);
  }, [rows, positions, lines]);

  const specialtiesForPositionId = (positionId: string): Specialty[] => {
    if (!positionId) return [];
    const rateSpecialtyIds = new Set(rows.map((r) => r.specialtyId).filter(Boolean) as string[]);
    // Also include any specialty currently referenced by a line on this quote.
    for (const line of lines) {
      if (line.specialtyId) rateSpecialtyIds.add(line.specialtyId);
    }
    return specialties
      .filter((s) => s.positionId === positionId && rateSpecialtyIds.has(s.id))
      .sort((a, b) => a.sortOrder - b.sortOrder);
  };

  // Resolve position/specialty IDs for a line when missing (pre-migration saved quotes).
  // Fallback chain: stored IDs → text columns → service_key parse.
  const resolveIdsForLine = (line: { positionId?: string; specialtyId?: string; department?: string; specialty?: string; position?: string; serviceKey?: string }): { positionId: string; specialtyId: string } => {
    let positionId = line.positionId || "";
    let specialtyId = line.specialtyId || "";
    let deptText = (line.department || "").trim().toLowerCase();
    let spcText = (line.specialty || "").trim().toLowerCase();

    // Fallback: parse service_key if discrete text columns are empty.
    // Known formats: 5-part "date|dept|position|specialty|rateMode" or
    // 6-part with shiftLabel inserted.
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
    return { positionId, specialtyId };
  };

  // Find the rate row for a line (by specialtyId preferred, then by name match).
  const findRateRowForLine = (line: { specialtyId?: string; position?: string; specialty?: string }): RateRow => {
    if (line.specialtyId) {
      const byId = rows.find((r) => r.specialtyId === line.specialtyId);
      if (byId) return byId;
    }
    if (line.position && line.specialty) {
      const byName = rows.find((r) => r.position === line.position && r.specialty === line.specialty);
      if (byName) return byName;
    }
    return rows[0] ?? DEFAULT_RATE_ROWS[0];
  };

  const draftWorkspaces = loadQuoteDraftWorkspaces();
  const QTY_OPTIONS = useMemo(() => Array.from({ length: 50 }, (_, i) => i + 1), []);
  const TIME_OPTIONS = useMemo(() => timeOptions(), []);

  function emptyLine(rateRows: RateRow[]): Line {
    const first = rateRows[0] ?? DEFAULT_RATE_ROWS[0];
    const pos = positions.find((p) => p.name === first.position);
    const spc = specialties.find((s) => s.id === first.specialtyId) ?? specialties.find((s) => s.positionId === pos?.id && s.name === first.specialty);
    return {
      id: 1,
      positionId: pos?.id ?? "",
      specialtyId: spc?.id ?? first.specialtyId ?? "",
      department: first.position,
      position: first.position,
      specialty: first.specialty,
      quoteDate: "",
      endDate: "",
      shiftLabel: "Shift 1",
      startTime: "",
      endTime: "",
      qty: 1,
      rateMode: "hourly" as RateMode,
      holidayHours: 0,
      travel: first.travel
    } as Line;
  }

  function applyDraftState(state: Partial<DraftState>) {
    setQuoteId(state.quoteId || "");
    setClientId(state.clientId || "");
    setClient(state.client || "");
    setEventName(state.eventName || "");
    setVenue(state.venue || "");
    setCityState(state.cityState || "");
    setStartDate(state.startDate || "");
    setEndDate(state.endDate || "");
    setDefaultStartTime(state.defaultStartTime || "");
    setDefaultEndTime(state.defaultEndTime || "");
    setExpectedHoursPerDay(state.expectedHoursPerDay || 10);
    setDepositPct(state.depositPct || 50);
    setTerms(state.terms || loadTerms());
    setLinkedJobRequestId(state.linkedJobRequestId || "");
    setLinkedJobSheetId(state.linkedJobSheetId || "");
    setSignatureName(state.signatureName || "");
    setSignedAt(state.signedAt || "");
    setActiveRateCardProfileIdState(state.activeRateCardProfileId || getActiveRateCardProfileId());
    setLines(state.lines && state.lines.length ? state.lines : [emptyLine(rows)]);
    setDayDetails(state.dayDetails || []);
  }

  function currentDraftState(): DraftState {
    return {
      quoteId, clientId, client, eventName, venue, cityState, startDate, endDate,
      defaultStartTime, defaultEndTime, expectedHoursPerDay, depositPct, terms,
      linkedJobRequestId, linkedJobSheetId, signatureName, signedAt,
      activeRateCardProfileId, lines, dayDetails
    };
  }

  function saveDraft(manualName?: string) {
    const id = activeDraftId || `quote-draft-${Date.now()}`;
    const name = manualName || draftName || "Working Draft";
    upsertQuoteDraftWorkspace({
      id,
      clientId: clientId || undefined,
      name,
      updatedAt: new Date().toISOString(),
      data: currentDraftState()
    });
    setActiveDraftIdState(id);
    setActiveQuoteDraft(id);
    setDraftName(name);
    setDraftTick((x) => x + 1);
    setStatusMsg("Quote draft saved.");
  }

  function loadDraft(id: string) {
    const found = loadQuoteDraftWorkspaces().find((d) => d.id === id);
    if (!found) return;
    setActiveDraftIdState(found.id);
    setActiveQuoteDraft(found.id);
    setDraftName(found.name);
    const data = found.data || {};
    // Fall back to top-level clientId if JSONB predates clientId being stored
    applyDraftState({ ...data, clientId: data.clientId || found.clientId || "" });
    setStatusMsg("Quote draft loaded.");
  }

  useEffect(() => {
    supabase.from("clients").select("id, name").eq("is_active", true).order("name")
      .then(({ data }) => {
        const list = (data ?? []).map((r: any) => ({ id: r.id, name: r.name }));
        setClientsList(list);
      });

    const latestRows = loadRateRows();
    setRows(latestRows);
    setTerms(loadTerms());
    setClient(loadClientName());
    setActiveRateCardProfileIdState(getActiveRateCardProfileId());

    const seed = getQuoteSeed();
    const activeDraftId = getActiveQuoteDraft();
    const drafts = loadQuoteDraftWorkspaces();
    const activeDraft = drafts.find((d) => d.id === activeDraftId) || drafts[0] || null;

    if (seed) {
      applyDraftState({
        quoteId: seed.id || "",
        linkedJobRequestId: seed.linkedJobRequestId || "",
        client: seed.client || "",
        eventName: seed.eventName || "",
        venue: seed.venue || "",
        cityState: seed.cityState || "",
        startDate: seed.startDate || "",
        endDate: seed.endDate || "",
        defaultStartTime: seed.startTime || "",
        defaultEndTime: seed.endTime || "",
        expectedHoursPerDay: seed.expectedHoursPerDay || 10,
        linkedJobSheetId: seed.linkedJobSheetId || "",
        signatureName: seed.signatureName || "",
        signedAt: seed.signedAt || "",
        terms: loadTerms(),
        lines: [emptyLine(latestRows)],
        dayDetails: []
      });
      setQuoteSeed(null);
    } else if (activeDraft) {
      setActiveDraftIdState(activeDraft.id);
      setDraftName(activeDraft.name);
      applyDraftState(activeDraft.data || {});
      setStatusMsg("Loaded last working quote draft.");
    } else {
      setLines([emptyLine(latestRows)]);
    }

    // Hot-fix (2026-04-29): no longer auto-load a saved quote on mount.
    // Drafts (work-in-progress) still auto-load above — that's continuity.
    // Saved quotes only load when explicitly picked from the dropdown.
    // Removes the silent-glue-to-stale-data class of bug where a previous
    // session's `aes_active_quote_v1` would auto-pin the user to a stale
    // (or corrupted) row on every refresh.
  }, []);

  useEffect(() => {
    const dates = daysInclusive(startDate, endDate);
    if (dates.length === 0) {
      setDayDetails([]);
      return;
    }
    setDayDetails((prev) => dates.map((date, idx) => {
      const found = prev.find((p) => p.date === date);
      return found || {
        id: Date.now() + idx,
        date,
        defaultStartTime: defaultStartTime || "",
        defaultEndTime: defaultEndTime || "",
        expectedHours: expectedHoursPerDay || 10
      };
    }));
    setLines((prev) => prev.map((line) => ({
      ...line,
      quoteDate: line.quoteDate || dates[0],
      startTime: line.startTime || defaultStartTime || "",
      endTime: line.endTime || defaultEndTime || ""
    })));
  }, [startDate, endDate]);

  useEffect(() => {
    if (!client && !eventName && !venue && !startDate && !lines.length) return;
    saveDraft(activeDraftId ? undefined : "Working Draft");
  }, [client, eventName, venue, cityState, startDate, endDate, defaultStartTime, defaultEndTime, expectedHoursPerDay, depositPct, linkedJobRequestId, linkedJobSheetId, signatureName, signedAt, terms, lines, dayDetails]);

  function addLine() {
    const first = rows[0] ?? DEFAULT_RATE_ROWS[0];
    const firstDate = dayDetails[0]?.date || "";
    const pos = positions.find((p) => p.name === first.position);
    const spc = specialties.find((s) => s.id === first.specialtyId) ?? specialties.find((s) => s.positionId === pos?.id && s.name === first.specialty);
    setLines([
      ...lines,
      {
        id: Date.now(),
        positionId: pos?.id ?? "",
        specialtyId: spc?.id ?? first.specialtyId ?? "",
        department: first.position,
        position: first.position,
        specialty: first.specialty,
        quoteDate: firstDate,
        endDate: firstDate,
        shiftLabel: `Shift ${lines.length + 1}`,
        startTime: defaultStartTime || "",
        endTime: defaultEndTime || "",
        qty: 1,
        rateMode: "hourly",
        holidayHours: 0,
        travel: first.travel
      }
    ]);
  }

  function deleteLine(id:number) {
    setLines(lines.filter((line) => line.id !== id));
    setStatusMsg("Line item deleted.");
  }

  function duplicateLine(id:number) {
    const found = lines.find((line) => line.id === id);
    if (!found) return;
    setLines([
      ...lines,
      {
        ...found,
        id: Date.now(),
        shiftLabel: `${found.shiftLabel} Copy`
      }
    ]);
    setStatusMsg("Line item copied.");
  }

  function updateLine(id:number, patch:Partial<Line>) { setLines(lines.map(line => line.id === id ? { ...line, ...patch } : line)); }
  function updateDay(id:number, patch:Partial<DayDetail>) { setDayDetails(dayDetails.map(d => d.id === id ? { ...d, ...patch } : d)); }
  function currentQuoteId() {
    // Hot-fix (2026-04-29): never trust the cached `quoteId` state. It can carry
    // over from a different draft (the JSONB workspace stores it and reloads on
    // every draft load), which is what caused the slug-overwrite corruption seen
    // in 2026-04 (Connor's incident). Only use the cached id when we're editing
    // a quote that's already saved in the quotes table — i.e. activeSavedQuoteId
    // is set. In every other case, derive fresh from current content.
    if (activeSavedQuoteId) return activeSavedQuoteId;
    return `${client || "client"}-${eventName || "event"}-${startDate || Date.now()}`.replace(/\s+/g, "-").toLowerCase();
  }

  const computed = useMemo(() => lines.map((line, idx) => {
    const row = findRateRowForLine(line);
    const hours = hoursBetween(line.startTime, line.endTime);
    const total = calcLineTotal(hours, line.holidayHours, line.qty, row, line.travel, line.rateMode);
    return { no: idx + 1, line, row, hours, total };
  }), [lines, rows, positions, specialties]);

  const grouped = useMemo(() => {
    const map = new Map<string, Map<string, typeof computed>>();
    computed.forEach((item) => {
      const dateKey = item.line.quoteDate || "No Date";
      // Group by position name (the real concept). Fallback to rate row's position.
      const posKey = item.line.position || item.row.position || "Unassigned";
      if (!map.has(dateKey)) map.set(dateKey, new Map());
      const posMap = map.get(dateKey)!;
      if (!posMap.has(posKey)) posMap.set(posKey, []);
      posMap.get(posKey)!.push(item);
    });
    return Array.from(map.entries()).map(([date, posMap]) => ({
      date,
      day: dayDetails.find((d) => d.date === date),
      positions: Array.from(posMap.entries()).map(([position, items]) => ({
        position,
        items,
        total: items.reduce((sum, i) => sum + i.total, 0)
      })),
      total: Array.from(posMap.values()).flat().reduce((sum, i) => sum + i.total, 0)
    })).sort((a,b) => a.date.localeCompare(b.date));
  }, [computed, dayDetails]);

  const subtotal = grouped.reduce((sum, g) => sum + g.total, 0);
  const deposit = subtotal * (depositPct / 100);
  const amountDue = subtotal - deposit;

  function saveQuote(): QuoteDraft {
    // Hot-fix (2026-04-29): validate before save. Quotes need a start_date and
    // every line item needs a quote_date — without them, downstream features
    // (job sheets, timesheets, invoices, hour calculations) all break. Block
    // here rather than letting a half-built quote into the system.
    if (!startDate) {
      const msg = "Please set the quote's Start Date before saving.";
      if (typeof window !== "undefined") alert(msg);
      setStatusMsg(msg);
      throw new Error(msg);
    }
    const linesWithoutDate = lines.filter((l) => !l.quoteDate);
    if (linesWithoutDate.length > 0) {
      const msg = `Please assign a date to all line items before saving (${linesWithoutDate.length} line${linesWithoutDate.length === 1 ? "" : "s"} missing a date).`;
      if (typeof window !== "undefined") alert(msg);
      setStatusMsg(msg);
      throw new Error(msg);
    }

    const lineItems: QuoteLine[] = grouped.flatMap((group) => {
      // Hot-fix (2026-04-29): "No Date" is a UI grouping label only — it must
      // never reach the DB, where quote_date / end_date are real `date`-typed
      // columns since migration 20260421a. Convert the placeholder to empty
      // string so the column mapper stores null. Same goes for serviceKey,
      // which is a legacy composite text column but cleaner without "No Date".
      const safeDate = (group.date && group.date !== "No Date") ? group.date : "";
      return group.positions.flatMap((pos) =>
        pos.items.map((item) => ({
          serviceKey: `${safeDate} | ${pos.position} | ${item.row.specialty} | ${item.line.shiftLabel} | ${item.line.rateMode}`,
          qty: item.line.qty,
          hours: item.hours,
          holidayHours: item.line.holidayHours,
          travel: item.line.travel,
          baseHourly: item.row.hourly,
          baseDay: item.row.day,
          otRate: item.row.otRate,
          dtRate: item.row.dtRate,
          rule: `${item.line.startTime || "-"} to ${item.line.endTime || "-"} | ${item.line.rateMode === "hourly" ? "Hourly" : "Day Rate"} | ${formatOtTriggerRule(item.row.dtAfter)}`,
          total: item.total,
          positionId: item.line.positionId || undefined,
          specialtyId: item.line.specialtyId || undefined,
          department: pos.position,   // kept for backward compat
          specialty: item.row.specialty,
          shiftLabel: item.line.shiftLabel,
          quoteDate: safeDate,
          endDate: item.line.endDate || safeDate,
          startTime: item.line.startTime,
          endTime: item.line.endTime,
          rateMode: item.line.rateMode
        }))
      );
    });

    const quote: QuoteDraft = {
      id: currentQuoteId(),
      clientId: clientId || undefined,
      client,
      eventName,
      venue,
      cityState,
      startDate,
      endDate,
      startTime: defaultStartTime,
      endTime: defaultEndTime,
      expectedHoursPerDay,
      total: subtotal,
      deposit,
      status: "quoted",
      notes: "",
      lines: lineItems,
      terms,
      linkedJobRequestId,
      linkedJobSheetId,
      timesheetSummary: timeSummary,
      signatureName,
      signedAt,
      rateCardProfileId: activeRateCardProfileId || "",
    };
    upsertQuote(quote);
    setActiveQuote(quote.id);
    setQuoteId(quote.id);
    setActiveSavedQuoteId(quote.id);
    return quote;
  }

  // Hot-fix (2026-04-29): full form reset. Used at the top of loadSavedQuote
  // so picking any option in the saved-quotes dropdown starts from a clean
  // slate before the picked quote's data is applied. Without this, residual
  // state (dayDetails, draft pointers, signature info) from the previously-
  // loaded quote could leak into the new selection.
  function resetFormState() {
    setQuoteId("");
    setClientId("");
    setClient("");
    setEventName("");
    setVenue("");
    setCityState("");
    setStartDate("");
    setEndDate("");
    setDefaultStartTime("");
    setDefaultEndTime("");
    setExpectedHoursPerDay(10);
    setDepositPct(50);
    setTerms(loadTerms());
    setLinkedJobRequestId("");
    setLinkedJobSheetId("");
    setSignatureName("");
    setSignedAt("");
    setLines([emptyLine(rows)]);
    setDayDetails([]);
    setActiveSavedQuoteId("");
    setActiveQuote("");
    setActiveDraftIdState("");
    setActiveQuoteDraft("");
    setDraftName("");
  }

  function loadSavedQuote(id: string) {
    // Always reset first so residual state from a prior selection doesn't
    // leak into the newly-loaded quote. Picking "New / Unsaved Quote" (id="")
    // ends here with a fully blank form. Picking a real quote then re-applies
    // that quote's fields below.
    resetFormState();
    if (!id) {
      setStatusMsg("Started fresh — form cleared.");
      return;
    }
    const q = savedQuotes.find((x) => x.id === id);
    if (!q) return;
    setQuoteId(q.id);
    setClientId(q.clientId || "");
    setClient(q.client);
    setEventName(q.eventName);
    setVenue(q.venue);
    setCityState(q.cityState);
    setStartDate(q.startDate);
    setEndDate(q.endDate);
    setDefaultStartTime(q.startTime);
    setDefaultEndTime(q.endTime);
    setExpectedHoursPerDay(q.expectedHoursPerDay || 10);
    setLinkedJobRequestId(q.linkedJobRequestId || "");
    setLinkedJobSheetId(q.linkedJobSheetId || "");
    setSignatureName(q.signatureName || "");
    setSignedAt(q.signedAt || "");
    setTerms(q.terms);
    setActiveRateCardProfileIdState(q.rateCardProfileId || "");
    setLines(q.lines.map((l, i) => {
      // Use discrete columns if available, fall back to parsing serviceKey/rule
      let department = l.department || "";
      let specialty = l.specialty || "";
      let shiftLabel = l.shiftLabel || `Shift ${i + 1}`;
      let quoteDate = l.quoteDate || "";
      let startTime = l.startTime || "";
      let endTime = l.endTime || "";
      let rateMode: RateMode = (l.rateMode === "day" ? "day" : "hourly");

      if (!department) {
        const parts = l.serviceKey.split(" | ");
        if (parts.length >= 6) {
          quoteDate   = parts[0];
          department  = parts[1];
          specialty   = parts[3];
          shiftLabel  = parts[4] || shiftLabel;
          rateMode    = parts[5] === "day" ? "day" : "hourly";
        } else if (parts.length === 2) {
          department = parts[0];
          specialty  = parts[1];
        }
        const ruleParts = (l.rule || "").split(" | ")[0].split(" to ");
        startTime = ruleParts[0] || "";
        endTime   = ruleParts[1] || "";
      }

      // Resolve FK ids: prefer stored IDs, fall back to name match on legacy rows
      const ids = resolveIdsForLine({ positionId: l.positionId, specialtyId: l.specialtyId, department, specialty, position: department });

      return {
        id: Date.now() + i,
        positionId: ids.positionId,
        specialtyId: ids.specialtyId,
        department,
        position: department,
        specialty,
        quoteDate,
        endDate: l.endDate || quoteDate,
        shiftLabel,
        startTime,
        endTime,
        qty: l.qty,
        rateMode,
        holidayHours: l.holidayHours,
        travel: l.travel
      };
    }));
    setActiveSavedQuoteId(id);
    setActiveQuote(id);
    setStatusMsg("Quote loaded.");
  }

  function loadJobRequestIntoQuote(id: string) {
    const r = jobRequests.find((x) => x.id === id);
    if (!r) return;
    setLinkedJobRequestId(r.id);
    setClient(r.client);
    setEventName(r.eventName);
    setVenue(r.venue);
    setCityState(r.cityState);
    setStartDate(r.requestDate);
    setEndDate(r.endDate || r.requestDate);
    setDefaultStartTime(r.startTime);
    setDefaultEndTime(r.endTime);
    setExpectedHoursPerDay(r.expectedHours || 10);
    setStatusMsg("Job request loaded into quote.");
  }

  function loadRateCardProfileIntoQuote(id: string) {
    if (!id) return;
    loadProfileIntoCurrent(id);
    setRows(loadRateRows());
    setTerms(loadTerms());
    setClient(loadClientName());
    setActiveRateCardProfileIdState(id);
    setStatusMsg("Client rate card loaded.");
  }

  async function saveInvoiceDraft() {
    // Hot-fix (2026-04-29): require an explicitly saved quote before generating
    // an invoice. Previously this function called saveQuote() as a side effect,
    // which combined with stale quoteId state could overwrite an unrelated quote
    // row. Decoupling here means invoice generation is a read of a saved quote,
    // never a write to the quotes table.
    if (!activeSavedQuoteId) {
      const msg = "Please click 'Save Quote' first — invoice generation now requires a saved quote.";
      if (typeof window !== "undefined") alert(msg);
      setStatusMsg(msg);
      return;
    }
    const savedQuote = loadQuotes().find((q) => q.id === activeSavedQuoteId);
    if (!savedQuote) {
      const msg = "Saved quote not found in cache — please click 'Save Quote' again.";
      if (typeof window !== "undefined") alert(msg);
      setStatusMsg(msg);
      return;
    }

    // Hot-fix (2026-04-29): refuse to generate a new invoice if a non-draft
    // invoice already exists for this quote. The previous code used a
    // deterministic invoice id (`inv-${quote.id}`) which meant every new
    // generation would overwrite the existing invoice — destroying line items
    // on already-issued or paid invoices via syncInvoiceLines' delete-then-
    // insert. This is the invoice-side analogue of Connor's quote-overwrite
    // bug. With unique invoice ids below, accidental collisions are gone, but
    // the real intent ("I want a new invoice for this quote that isn't a
    // duplicate of an existing finalized one") deserves a deliberate confirm.
    const existingInvoices = loadInvoiceDrafts().filter((i) => i.quoteId === savedQuote.id);
    const existingNonDraft = existingInvoices.find((i) => i.status && i.status !== "draft");
    if (existingNonDraft) {
      const proceed = typeof window !== "undefined"
        ? window.confirm(
            `An invoice (${existingNonDraft.invoiceNo}) for this quote already exists with status "${existingNonDraft.status}". `
            + `Generating a new invoice will create an additional row, not modify the existing one. Continue?`
          )
        : true;
      if (!proceed) {
        setStatusMsg("Invoice generation cancelled.");
        return;
      }
    }

    // Hot-fix (2026-04-29): unique invoice id per generation. Previously this
    // was `inv-${savedQuote.id}` — deterministic, so re-generating against the
    // same quote silently overwrote the prior invoice and nuked its line items.
    //
    // Refinement: if a *draft* invoice already exists for this quote, reuse
    // its id (so we update it in place rather than creating duplicate drafts).
    // Drafts are mutable workspace — re-clicking Save Invoice Draft means
    // "refresh the draft with the latest quote data". Non-draft invoices
    // (issued/sent/paid) get a new id alongside the protected one — handled
    // above via the confirm prompt.
    const existingDraft = existingInvoices.find((i) => !i.status || i.status === "draft");
    const invoiceId = existingDraft
      ? existingDraft.id
      : `inv-${Date.now()}-${savedQuote.id.slice(0, 60)}`;
    const issueDate = new Date().toISOString().slice(0, 10);
    const dueDate = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const invSubtotal = savedQuote.total ?? 0;
    const invDeposit = savedQuote.deposit ?? 0;
    const invAmountDue = invSubtotal - invDeposit;

    const invoice: InvoiceDraft = {
      id: invoiceId,
      quoteId: savedQuote.id,
      invoiceNo: `INV-${new Date().getFullYear()}-${String(new Date().getMonth()+1).padStart(2,"0")}${String(new Date().getDate()).padStart(2,"0")}-${String(Math.floor(Math.random()*900)+100)}`,
      issueDate,
      dueDate,
      poNo: "",
      billTo: savedQuote.client || "",
      clientId: savedQuote.clientId || undefined,
      client: savedQuote.client || "",
      eventName: savedQuote.eventName || "",
      venue: savedQuote.venue || "",
      cityState: savedQuote.cityState || "",
      lines: savedQuote.lines || [],
      subtotal: invSubtotal,
      deposit: invDeposit,
      amountDue: invAmountDue,
      terms: savedQuote.terms || "",
      notes: "",
      status: "draft",
      paidAmount: 0,
      linkedJobSheetId: savedQuote.linkedJobSheetId,
      timesheetSummary: savedQuote.timesheetSummary,
      rateCardProfileId: savedQuote.rateCardProfileId || "",
    };
    // Hot-fix (2026-04-29): await the save before navigating. Previously this
    // fired upsertInvoiceDraft and immediately navigated to /invoices — if the
    // save failed (e.g. Safari blocking the cross-origin POST), the navigation
    // happened anyway and dropped the user on a page that re-fetched from the
    // server, replacing the optimistic local cache and losing the invoice.
    // Now we wait for the save result; on failure we alert and stay put.
    setStatusMsg("Saving invoice…");
    const result = await upsertInvoiceDraft(invoice);
    if (result && result.error) {
      setStatusMsg("Invoice save failed. See alert / console for details.");
      return;
    }
    setActiveInvoice(invoice.id);
    window.location.href = "/invoices";
  }

  const workingOn = activeSavedQuoteId
    ? { label: "Saved Quote", detail: `${client || "—"} — ${eventName || "—"}`, color: "#0369a1", bg: "#e0f2fe" }
    : activeDraftId
    ? { label: "Draft", detail: draftName || "Working Draft", color: "#7c3aed", bg: "#ede9fe" }
    : { label: "New / Unsaved", detail: "Not yet saved", color: "#888", bg: "#f3f4f6" };

  return (
    <div className="grid">
      <div className="card hide-print">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <h2 className="section-title" style={{ margin: 0 }}>Quote Builder</h2>
            <button
              className="secondary"
              onClick={() => loadSavedQuote("")}
              title="Clear the form and start a brand new quote"
              style={{ fontSize: 13 }}
            >
              + New Quote
            </button>
          </div>
          <div style={{ background: workingOn.bg, border: `1px solid ${workingOn.color}`, borderRadius: 8, padding: "6px 14px", display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", color: workingOn.color }}>{workingOn.label}</span>
            <span style={{ fontSize: 13, color: workingOn.color }}>{workingOn.detail}</span>
          </div>
        </div>
        <div className="grid4">
          <div><small>Saved Quote Drafts</small><select value={activeDraftId} onChange={(e)=>loadDraft(e.target.value)}><option value="">Select Draft</option>{draftWorkspaces.map((d)=><option key={d.id} value={d.id}>{d.name} — {new Date(d.updatedAt).toLocaleString()}</option>)}</select></div>
          <div><small>Draft Name</small><input value={draftName} onChange={(e)=>setDraftName(e.target.value)} /></div>
          <div className="action-row" style={{ alignItems: "end" }}><button onClick={() => saveDraft()}>Save Draft</button></div>
          <div><small>Saved Quotes</small><select value={activeSavedQuoteId} onChange={(e)=>loadSavedQuote(e.target.value)}><option value="">New / Unsaved Quote</option>{savedQuotes.map((q)=><option key={q.id} value={q.id}>{q.client} — {q.eventName}</option>)}</select></div>

          <div>
            <small>Client</small>
            <select value={clientId} onChange={(e) => {
              const c = clientsList.find((c) => c.id === e.target.value);
              setClientId(e.target.value);
              setClient(c?.name ?? client);
            }}>
              <option value="">— Select Client —</option>
              {clientsList.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div><small>Event / Job</small><input value={eventName} onChange={(e)=>setEventName(e.target.value)} /></div>
          <div><small>Venue</small><input value={venue} onChange={(e)=>setVenue(e.target.value)} /></div>
          <div><small>City / State</small><input value={cityState} onChange={(e)=>setCityState(e.target.value)} /></div>

          <div><small>Load Client Rate Card</small><select value={activeRateCardProfileId} disabled={!clientId} onChange={(e)=>loadRateCardProfileIntoQuote(e.target.value)}><option value="">{clientId ? "Current Working Rate Card" : "— Select a client first —"}</option>{clientId && rateCardProfiles.filter((r) => r.clientId === clientId).map((r)=><option key={r.id} value={r.id}>{r.name || r.clientName}</option>)}</select></div>
          <div><small>Load Job Request</small><select value={linkedJobRequestId} disabled={!clientId} onChange={(e)=>loadJobRequestIntoQuote(e.target.value)}><option value="">{clientId ? "None" : "— Select a client first —"}</option>{clientId && jobRequests.filter((r) => r.clientId === clientId).map((r)=><option key={r.id} value={r.id}>{r.eventName || r.client}</option>)}</select></div>
          <div><small>Linked Job Sheet</small><select value={linkedJobSheetId} onChange={(e)=>setLinkedJobSheetId(e.target.value)}><option value="">None</option>{jobSheets.map((s)=><option key={s.id} value={s.id}>{s.title}</option>)}</select></div>

          <div><small>Start Date</small><input type="date" value={startDate} onChange={(e)=>setStartDate(e.target.value)} /></div>
          <div><small>End Date</small><input type="date" value={endDate} onChange={(e)=>setEndDate(e.target.value)} /></div>
          <div><small>Default Start Time</small><input value={defaultStartTime} onChange={(e)=>setDefaultStartTime(e.target.value)} /></div>
          <div><small>Default End Time</small><input value={defaultEndTime} onChange={(e)=>setDefaultEndTime(e.target.value)} /></div>
          <div><small>Expected Hours / Day</small><input type="number" value={expectedHoursPerDay} onChange={(e)=>setExpectedHoursPerDay(Number(e.target.value || 0))} /></div>
          <div><small>Deposit %</small><input type="number" value={depositPct} onChange={(e)=>setDepositPct(Number(e.target.value || 0))} /></div>
          <div><small>Electronic Signature Name</small><input value={signatureName} onChange={(e)=>setSignatureName(e.target.value)} placeholder="Type signer name" /></div>
          <div><small>Prepared By Name</small><input value={preparedByName} onChange={(e)=>setPreparedByName(e.target.value)} /></div>
          <div><small>Prepared By Title</small><input value={preparedByTitle} onChange={(e)=>setPreparedByTitle(e.target.value)} /></div>
          <div><small>Signed At</small><input type="datetime-local" value={signedAt} onChange={(e)=>setSignedAt(e.target.value)} /></div>
        </div>
      </div>

      <div className="doc-sheet">

  <div className="pdf-header branded-header">
    <div className="pdf-header-inner">
      <img src="/branding/client-logo.png" alt="Logo" className="pdf-logo" />
    </div>
  </div>

  <div className="hide-print action-row" style={{ marginBottom: 12 }}>

          <button onClick={() => printWithTitle([
            "Quote",
            eventName,
            client,
            startDate,
          ])}>Download / Print PDF</button>
          <small className="muted" style={{ alignSelf: "center" }}>Tip: uncheck "Headers and footers" in the browser's print dialog to hide the URL.</small>
          <button className="secondary" onClick={addLine}>Add Shift / Line Item</button>
          <button className="secondary" onClick={() => { saveQuote(); setStatusMsg("Quote saved."); }}>Save Quote</button>
          <button className="secondary" onClick={saveInvoiceDraft}>Save Invoice Draft</button>
          {statusMsg ? <span className="badge">{statusMsg}</span> : null}
        </div>


<div className="quote-cover-page">
  <div className="quote-cover-inner">
    
    <h1 className="quote-cover-title">{eventName || "Event Quote"}</h1>
    <div className="quote-cover-client">{client || "Client Name"}</div>

    <div className="quote-cover-grid">
      <div className="cover-card"><div className="cover-label">Client</div><div className="cover-value">{client || "-"}</div></div>
      <div className="cover-card"><div className="cover-label">Event / Job</div><div className="cover-value">{eventName || "-"}</div></div>
      <div className="cover-card"><div className="cover-label">Venue</div><div className="cover-value">{venue || "-"}</div></div>
      <div className="cover-card"><div className="cover-label">City / State</div><div className="cover-value">{cityState || "-"}</div></div>
      <div className="cover-card"><div className="cover-label">Start Date</div><div className="cover-value">{startDate || "-"}</div></div>
      <div className="cover-card"><div className="cover-label">End Date</div><div className="cover-value">{endDate || "-"}</div></div>
      <div className="cover-card"><div className="cover-label">Default Start</div><div className="cover-value">{defaultStartTime || "-"}</div></div>
      <div className="cover-card"><div className="cover-label">Default End</div><div className="cover-value">{defaultEndTime || "-"}</div></div>
      <div className="cover-card"><div className="cover-label">Expected Hours / Day</div><div className="cover-value">{expectedHoursPerDay || "-"}</div></div>
      <div className="cover-card"><div className="cover-label">Prepared For</div><div className="cover-value">{client || "-"}</div></div>
    </div>
  </div>
</div>

        <div className="hide-print" style={{ marginBottom: 18 }}>
          <h3 className="section-title">Requested Schedule</h3>
          <div style={{ overflowX:"auto" }}>
            <table>
              <thead><tr><th>Date</th><th>Default Start</th><th>Default End</th><th>Expected Hours</th></tr></thead>
              <tbody>
                {dayDetails.length === 0 ? <tr><td colSpan={4}>No dates selected yet.</td></tr> : dayDetails.map((d)=>
                  <tr key={d.id}>
                    <td>{d.date}</td>
                    <td style={{ minWidth: 130 }}><select value={normalizeTimeInput(d.defaultStartTime)} onChange={(e)=>updateDay(d.id,{ defaultStartTime:e.target.value })}>{TIME_OPTIONS.map((t)=><option key={t} value={t}>{t}</option>)}</select></td>
                    <td style={{ minWidth: 130 }}><select value={normalizeTimeInput(d.defaultEndTime)} onChange={(e)=>updateDay(d.id,{ defaultEndTime:e.target.value })}>{TIME_OPTIONS.map((t)=><option key={t} value={t}>{t}</option>)}</select></td>
                    <td><input type="number" value={d.expectedHours} onChange={(e)=>updateDay(d.id,{ expectedHours:Number(e.target.value || 0) })} /></td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="hide-print card" style={{ marginTop:16 }}>
          <h3 className="section-title">Edit Quote Line Items</h3>
          <div style={{ overflowX:"auto" }}>
            <table className="line-table">
              <thead>
                <tr>
                  <th>Start Date</th>
                  <th>End Date</th>
                  <th colSpan={2}>Position</th>
                  <th colSpan={2}>Specialty</th>
                  <th>Shift</th>
                  <th>Rate Mode</th>
                  <th rowSpan={2}>Action</th>
                </tr>
                <tr>
                  <th>Start</th>
                  <th>End</th>
                  <th>Hours</th>
                  <th>Applied Rate</th>
                  <th>Qty</th>
                  <th>Holiday Hrs</th>
                  <th>Travel</th>
                  <th>Line Total</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line, idx) => {
                  const calcHours = hoursBetween(line.startTime, line.endTime);
                  const band = `line-band-${idx % 4}`;
                  return (
                    <Fragment key={line.id}>
                      <tr className={`line-row ${band}`}>
                        <td>
                          <select value={line.quoteDate} onChange={(e)=>{
                            const newStart = e.target.value;
                            const newEnd = (!line.endDate || line.endDate < newStart) ? newStart : line.endDate;
                            updateLine(line.id, { quoteDate: newStart, endDate: newEnd });
                          }}>
                            <option value="">Select Date</option>
                            {dayDetails.map((d)=><option key={d.date} value={d.date}>{d.date}</option>)}
                          </select>
                        </td>
                        <td>
                          <select value={line.endDate || line.quoteDate || ""} onChange={(e)=>updateLine(line.id, { endDate: e.target.value })}>
                            <option value="">Select Date</option>
                            {dayDetails.map((d)=><option key={d.date} value={d.date}>{d.date}</option>)}
                          </select>
                        </td>
                        <td colSpan={2}>
                          <select value={line.positionId} onChange={(e)=>{
                            const newPosId = e.target.value;
                            const newPos = positions.find((p) => p.id === newPosId);
                            const firstSpc = specialtiesForPositionId(newPosId)[0];
                            const row = rows.find((r) => r.specialtyId === firstSpc?.id);
                            updateLine(line.id, {
                              positionId: newPosId,
                              specialtyId: firstSpc?.id ?? "",
                              position: newPos?.name ?? "",
                              department: newPos?.name ?? "",
                              specialty: firstSpc?.name ?? "",
                              travel: row?.travel ?? 0,
                            });
                          }}>
                            <option value="">— Select Position —</option>
                            {availablePositions.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                          </select>
                        </td>
                        <td colSpan={2}>
                          <select value={line.specialtyId} onChange={(e)=>{
                            const newSpcId = e.target.value;
                            const newSpc = specialties.find((s) => s.id === newSpcId);
                            const row = rows.find((r) => r.specialtyId === newSpcId);
                            updateLine(line.id, {
                              specialtyId: newSpcId,
                              specialty: newSpc?.name ?? "",
                              travel: row?.travel ?? 0,
                            });
                          }}>
                            <option value="">— Select Specialty —</option>
                            {specialtiesForPositionId(line.positionId).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                          </select>
                        </td>
                        <td><input value={line.shiftLabel} onChange={(e)=>updateLine(line.id, { shiftLabel:e.target.value })} /></td>
                        <td>
                          <select value={line.rateMode} onChange={(e)=>updateLine(line.id, { rateMode:e.target.value as RateMode })}>
                            <option value="hourly">Hourly</option>
                            <option value="day">Day Rate</option>
                          </select>
                        </td>
                        <td rowSpan={2} style={{ verticalAlign: "middle" }}>
                          <div className="action-row" style={{ flexDirection: "column", gap: 6 }}>
                            <button type="button" className="secondary" onClick={()=>duplicateLine(line.id)}>Copy Line</button>
                            <button type="button" className="secondary" onClick={()=>deleteLine(line.id)}>Delete Line</button>
                          </div>
                        </td>
                      </tr>
                      <tr className={`line-row line-row-end ${band}`}>
                        <td><select value={normalizeTimeInput(line.startTime)} onChange={(e)=>updateLine(line.id, { startTime:e.target.value })}>{TIME_OPTIONS.map((t)=><option key={t} value={t}>{t}</option>)}</select></td>
                        <td><select value={normalizeTimeInput(line.endTime)} onChange={(e)=>updateLine(line.id, { endTime:e.target.value })}>{TIME_OPTIONS.map((t)=><option key={t} value={t}>{t}</option>)}</select></td>
                        <td>{calcHours.toFixed(2)}</td>
                        <td>{line.rateMode === "hourly" ? `$${findRateRowForLine(line).hourly.toFixed(2)}/hr` : `$${findRateRowForLine(line).day.toFixed(2)}/day`}</td>
                        <td><select value={line.qty} onChange={(e)=>updateLine(line.id, { qty:Number(e.target.value || 0) })}>{QTY_OPTIONS.map((q)=><option key={q} value={q}>{q}</option>)}</select></td>
                        <td><input type="number" value={line.holidayHours} onChange={(e)=>updateLine(line.id, { holidayHours:Number(e.target.value || 0) })} /></td>
                        <td><input type="number" value={line.travel} onChange={(e)=>updateLine(line.id, { travel:Number(e.target.value || 0) })} /></td>
                        <td>${calcLineTotal(calcHours, line.holidayHours, line.qty, findRateRowForLine(line), line.travel, line.rateMode).toFixed(2)}</td>
                      </tr>
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div style={{ marginTop: 18 }}>
          <h3 className="section-title">Client-Facing Price Breakdown</h3>
          <div style={{ overflowX:"auto", marginBottom: 14 }}>
            <table>
              <thead><tr><th>Date</th><th>Position</th><th>Specialty</th><th>Shift</th><th>Rate Mode</th><th>Qty</th><th>Start</th><th>End</th><th>Hours</th><th>Applied Rate</th><th>Holiday Hrs</th><th>Travel</th><th>Line Total</th></tr></thead>
              <tbody>
                {computed.length === 0 ? (
                  <tr><td colSpan={13}>No line items yet.</td></tr>
                ) : (
                  computed.map((item) => (
                    <tr key={`client-breakdown-${item.line.id}`}>
                      <td>{item.line.endDate && item.line.endDate !== item.line.quoteDate ? `${item.line.quoteDate} → ${item.line.endDate}` : (item.line.quoteDate || "-")}</td>
                      <td>{item.line.position || item.row.position}</td>
                      <td>{item.row.specialty}</td>
                      <td>{item.line.shiftLabel}</td>
                      <td>{item.line.rateMode === "hourly" ? "Hourly" : "Day Rate"}</td>
                      <td>{item.line.qty}</td>
                      <td>{item.line.startTime || "-"}</td>
                      <td>{item.line.endTime || "-"}</td>
                      <td>{item.hours.toFixed(2)}</td>
                      <td>{item.line.rateMode === "hourly" ? `$${item.row.hourly.toFixed(2)}/hr` : `$${item.row.day.toFixed(2)}/day`}</td>
                      <td>{item.line.holidayHours}</td>
                      <td>{item.line.travel ? `$${item.line.travel.toFixed(2)}` : "-"}</td>
                      <td>${item.total.toFixed(2)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          {grouped.length === 0 ? (
            <div className="muted">No grouped line items yet. Add dates and line items. The table above mirrors the exact quote you are building.</div>
          ) : grouped.map((group) => (
            <div key={group.date} className="quote-day-page" style={{ marginBottom: 22 }}>
              <div className="list-card" style={{ marginBottom: 10 }}>
                <strong>{group.date}</strong>
                <div className="muted">Default Day Schedule: {group.day?.defaultStartTime || "-"} to {group.day?.defaultEndTime || "-"} · Expected Hours: {group.day?.expectedHours ?? "-"}</div>
              </div>
              {group.positions.map((posGroup) => (
                <div key={posGroup.position} style={{ marginBottom: 12 }}>
                  <div className="badge" style={{ marginBottom: 6 }}>{posGroup.position}</div>
                  <div style={{ overflowX:"auto" }}>
                    <table>
                      <thead><tr><th>Date</th><th>Position</th><th>Specialty</th><th>Shift</th><th>Rate Mode</th><th>Qty</th><th>Start</th><th>End</th><th>Hours</th><th>Applied Rate</th><th>Holiday Hrs</th><th>Travel</th><th>OT</th><th>DT</th><th>Line Total</th></tr></thead>
                      <tbody>
                        {posGroup.items.map((item) => (
                          <tr key={`${group.date}-${posGroup.position}-${item.line.id}`}>
                            <td>{item.line.endDate && item.line.endDate !== group.date ? `${group.date} → ${item.line.endDate}` : group.date}</td>
                            <td>{posGroup.position}</td>
                            <td>{item.row.specialty}</td>
                            <td>{item.line.shiftLabel}</td>
                            <td>{item.line.rateMode === "hourly" ? "Hourly" : "Day Rate"}</td>
                            <td>{item.line.qty}</td>
                            <td>{item.line.startTime || "-"}</td>
                            <td>{item.line.endTime || "-"}</td>
                            <td>{item.hours.toFixed(2)}</td>
                            <td>{item.line.rateMode === "hourly" ? `$${item.row.hourly.toFixed(2)}/hr` : `$${item.row.day.toFixed(2)}/day`}</td>
                            <td>{item.line.holidayHours}</td>
                            <td>{item.line.travel ? `$${item.line.travel.toFixed(2)}` : "-"}</td>
                            <td>{item.line.rateMode === "day" ? `$${item.row.otRate.toFixed(2)}` : "-"}</td>
                            <td>{item.line.rateMode === "day" ? `$${item.row.dtRate.toFixed(2)}` : "-"}</td>
                            <td>${item.total.toFixed(2)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="metric-card" style={{ marginTop: 8 }}>
                    <div className="metric-label">{posGroup.position} Total for {group.date}</div>
                    <div className="metric-value" style={{ fontSize: 22 }}>${posGroup.total.toFixed(2)}</div>
                  </div>
                </div>
              ))}
              <div className="metric-card">
                <div className="metric-label">Date Total</div>
                <div className="metric-value" style={{ fontSize: 24 }}>${group.total.toFixed(2)}</div>
              </div>
            </div>
          ))}
        </div>

        {timeSummary.length > 0 ? (
          <div style={{ marginTop: 18 }}>
            <h3 className="section-title">Detailed Labor Breakdown from Timekeeping</h3>
            <div style={{ overflowX:"auto" }}>
              <table>
                <thead><tr><th>Position</th><th>Workers</th><th>STD Hours</th><th>OT Hours</th><th>DT Hours</th><th>Total Hours</th><th>Total Labor Pay</th></tr></thead>
                <tbody>{timeSummary.map((r) => <tr key={r.position}><td>{r.position}</td><td>{r.workers}</td><td>{r.stdHours.toFixed(2)}</td><td>{r.otHours.toFixed(2)}</td><td>{r.dtHours.toFixed(2)}</td><td>{r.totalHours.toFixed(2)}</td><td>${r.totalPay.toFixed(2)}</td></tr>)}</tbody>
              </table>
            </div>
          </div>
        ) : null}


        <div className="quote-final-page">
          <div className="grid3" style={{ marginTop:24 }}>
            <div className="metric-card"><div className="metric-label">Subtotal</div><div className="metric-value">${subtotal.toFixed(2)}</div></div>
            <div className="metric-card"><div className="metric-label">Deposit</div><div className="metric-value">${deposit.toFixed(2)}</div></div>
            <div className="metric-card"><div className="metric-label">Amount Due</div><div className="metric-value">${amountDue.toFixed(2)}</div></div>
          </div>

          <div className="quote-terms-block" style={{ marginTop:18 }}>
            <h3 className="section-title">Terms & Conditions</h3>
            <div className="quote-terms-text" style={{ whiteSpace:"pre-wrap", lineHeight:1.3 }}>{terms}</div>
          </div>

          <div style={{ marginTop: 18 }}>
            <h3 className="section-title">Electronic Signature</h3>
            <div className="list-card">
              <div><strong>Prepared By:</strong> {preparedByName || signatureName || "-"}</div>
              <div><strong>Title:</strong> {preparedByTitle || "-"}</div>
              <div><strong>Signer:</strong> {signatureName || "-"}</div>
              <div><strong>Signed At:</strong> {signedAt || "-"}</div>
            </div>
          </div>

          <div className="signature-block quote-signature-compact">
            <p><strong>Client Approval</strong></p>
            <p>Signature: ____________________________</p>
            <p>Name: {signatureName || "__________________"}</p>
            <p>Date: {signedAt || "__________________"}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
