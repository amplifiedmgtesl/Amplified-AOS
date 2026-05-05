/**
 * Draft editor for quotes (is_draft=true rows).
 *
 * Features:
 *  - Read-only event panel pulled live from the joined job_request
 *  - Rate card profile dropdown with recalc-on-change
 *  - Lines grouped by day (single-day jobs show one group)
 *  - Per-day "+ Add Line" with rate card position picker
 *  - Per-day "Copy from Day N-1" button (multi-day only)
 *  - Per-line edit (qty, hours, rate) + delete
 *  - Debounced autosave + manual Save Draft
 *  - Issue Quote (calls RPC) + Delete Draft
 *
 * Backed by lib/store/quotes.ts. Frozen rows redirect to the read-only detail page.
 */

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  loadQuote,
  saveDraft,
  issueDraft,
  deleteDraft,
  pickRateCardForJob,
} from "@/lib/store/quotes";
import type { QuoteDraft, QuoteLine, Position, Specialty } from "@/lib/store/types";
import { supabase } from "@/lib/supabase/client";

/** OT-trigger options + their canonical rule strings.
 *  Mirror of rate-card-editor.tsx triggerLabel() so the picker on a quote
 *  line stays consistent with what's offered on the rate card. */
const OT_TRIGGER_OPTIONS: Array<{ value: string; label: string; rule: string }> = [
  { value: "none",     label: "No OT (flat)",   rule: "No OT" },
  { value: "10",       label: "OT after 10",    rule: "OT after 10 / DT after 15" },
  { value: "11",       label: "OT after 11",    rule: "OT after 11 / DT after 15" },
  { value: "12",       label: "OT after 12",    rule: "OT after 12 / DT after 15" },
  { value: "13",       label: "OT after 13",    rule: "OT after 13 / DT after 15" },
  { value: "14",       label: "OT after 14",    rule: "OT after 14 / DT after 15" },
  { value: "15",       label: "OT after 15",    rule: "OT after 15 / DT after 15" },
  { value: "weekly40", label: "OT after 40/wk", rule: "OT after 40 / week" },
];

/** Map a stored rule string back to a trigger option for the dropdown. */
function ruleToTriggerValue(rule: string | undefined): string {
  if (!rule) return "12";
  const match = OT_TRIGGER_OPTIONS.find((o) => o.rule === rule);
  return match?.value ?? "12";
}

type DayInfo = {
  /** id of the job_request_day row, or a synthetic key for single-day jobs */
  id: string;
  date: string;
  startTime?: string;
  endTime?: string;
  /** human label for the day group ("Day 1 — 2026-05-12") */
  label: string;
};

export default function QuoteDraftEditor({ id }: { id: string }) {
  const router = useRouter();
  const [quote, setQuote] = useState<QuoteDraft | null>(null);
  const [job, setJob] = useState<any | null>(null);
  const [days, setDays] = useState<DayInfo[]>([]);
  const [parentRevisionNo, setParentRevisionNo] = useState<number | null>(null);
  const [rateCardRows, setRateCardRows] = useState<any[]>([]);
  const [allProfiles, setAllProfiles] = useState<any[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);
  const [specialties, setSpecialties] = useState<Specialty[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState<string | null>(null);
  const [addLineOpen, setAddLineOpen] = useState<string | null>(null); // day.id when open
  const [collapsedDays, setCollapsedDays] = useState<Set<string>>(new Set());
  const skipNextAutosaveRef = useRef(true); // skip the autosave that would fire from initial setQuote

  function toggleDayCollapsed(dayId: string) {
    setCollapsedDays((prev) => {
      const next = new Set(prev);
      if (next.has(dayId)) next.delete(dayId);
      else next.add(dayId);
      return next;
    });
  }

  // ── Load ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const q = await loadQuote(id);
        if (cancelled) return;
        if (!q) { setError(`Quote not found: ${id}`); setLoading(false); return; }
        if (!q.isDraft) { router.replace(`/quotes/${id}`); return; }
        setQuote(q);

        // Load related data in parallel
        const [jobRes, daysRes, profilesRes, posRes, spcRes] = await Promise.all([
          q.jobRequestId
            ? supabase.from("job_requests").select("*").eq("id", q.jobRequestId).maybeSingle()
            : Promise.resolve({ data: null, error: null }),
          q.jobRequestId
            ? supabase.from("job_request_days").select("*").eq("job_request_id", q.jobRequestId).order("sort_order")
            : Promise.resolve({ data: [], error: null }),
          supabase.from("rate_card_profiles").select("*").order("name"),
          supabase.from("positions").select("*").eq("is_active", true).order("sort_order"),
          supabase.from("specialties").select("*").eq("is_active", true).order("sort_order"),
        ]);
        if (cancelled) return;

        const jobRow = jobRes.data;
        setJob(jobRow);
        setAllProfiles(profilesRes.data ?? []);
        setPositions((posRes.data ?? []).map((r: any) => ({
          id: r.id, name: r.name, sortOrder: r.sort_order, isActive: r.is_active,
        })));
        setSpecialties((spcRes.data ?? []).map((r: any) => ({
          id: r.id, positionId: r.position_id, name: r.name, sortOrder: r.sort_order, isActive: r.is_active,
        })));

        // Build the day list. If no day rows, synthesize a single day from the job.
        const dayRows = (daysRes.data ?? []) as any[];
        const dayInfos: DayInfo[] = dayRows.length > 0
          ? dayRows.map((d, i) => ({
              id: d.id,
              date: d.event_date,
              startTime: d.start_time ?? undefined,
              endTime: d.end_time ?? undefined,
              label: `Day ${i + 1} — ${d.event_date}`,
            }))
          : jobRow
            ? [{
                id: `${jobRow.id}-virtual-day-0`,
                date: jobRow.request_date,
                startTime: jobRow.start_time ?? undefined,
                endTime: jobRow.end_time ?? undefined,
                label: jobRow.request_date,
              }]
            : [];
        setDays(dayInfos);

        // Parent revision number (for revision suffix projection)
        if (q.parentQuoteId) {
          const p = await supabase.from("quotes").select("revision_no").eq("id", q.parentQuoteId).maybeSingle();
          if (!cancelled) setParentRevisionNo(p.data?.revision_no ?? null);
        }

        // Rate card rows for the chosen profile (used by Add Line + recalculation)
        if (q.rateCardProfileId) {
          const rcRes = await supabase
            .from("rate_card_profile_rows")
            .select("*, specialties(id, name, position_id, positions(id, name))")
            .eq("profile_id", q.rateCardProfileId)
            .order("sort_order");
          if (!cancelled) setRateCardRows(rcRes.data ?? []);
        }

        setLoading(false);
      } catch (err: any) {
        if (cancelled) return;
        console.error("[quote-draft-editor] load failed:", err);
        setError(err.message || "Failed to load draft");
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [id, router]);

  // ── Autosave (debounced) ──────────────────────────────────────────────────
  useEffect(() => {
    if (!quote) return;
    if (skipNextAutosaveRef.current) {
      skipNextAutosaveRef.current = false;
      return;
    }
    setSaving("saving");
    const timer = setTimeout(async () => {
      try {
        await saveDraft(quote);
        setSaving("saved");
        setTimeout(() => setSaving((s) => (s === "saved" ? "idle" : s)), 1500);
      } catch (err: any) {
        setSaving("idle");
        console.error("[quote-draft-editor] autosave failed:", err);
      }
    }, 800);
    return () => clearTimeout(timer);
  }, [quote]);

  // ── Helpers ───────────────────────────────────────────────────────────────
  /** Round to dollars and cents — no fractional cents on quote lines. */
  function money(n: number): number {
    return Math.round(n * 100) / 100;
  }

  function recomputeLineTotal(l: QuoteLine): number {
    const qty = l.qty || 0;
    const travel = (l.travel || 0) * qty;
    if (l.rateMode === "day" || (l.baseDay > 0 && !l.hours)) {
      return money(qty * (l.baseDay || 0) + travel);
    }
    const regular = qty * (l.hours || 0) * (l.baseHourly || 0);
    // Holiday hours billed at 2x the regular hourly rate (per DEFAULT_TERMS).
    const holiday = qty * (l.holidayHours || 0) * (l.baseHourly || 0) * 2;
    return money(regular + holiday + travel);
  }
  function recomputeTotals(lines: QuoteLine[]): number {
    return lines.reduce((s, l) => s + (l.total || 0), 0);
  }

  function updateQuote(patch: Partial<QuoteDraft>) {
    if (!quote) return;
    setQuote({ ...quote, ...patch });
  }

  function updateLine(globalIndex: number, patch: Partial<QuoteLine>) {
    if (!quote) return;
    const newLines = quote.lines.map((l, i) => {
      if (i !== globalIndex) return l;
      const merged = { ...l, ...patch };
      merged.total = recomputeLineTotal(merged);
      return merged;
    });
    const newTotal = money(recomputeTotals(newLines));
    // Recompute deposit $ from stored pct so user intent persists across line edits.
    const pct = quote.depositPct ?? 0;
    const newDeposit = money(newTotal * (pct / 100));
    setQuote({ ...quote, lines: newLines, total: newTotal, deposit: newDeposit });
  }

  function deleteLine(globalIndex: number) {
    if (!quote) return;
    const newLines = quote.lines.filter((_, i) => i !== globalIndex);
    const newTotal = money(recomputeTotals(newLines));
    const pct = quote.depositPct ?? 0;
    const newDeposit = money(newTotal * (pct / 100));
    setQuote({ ...quote, lines: newLines, total: newTotal, deposit: newDeposit });
  }

  function addLine(day: DayInfo, rateRow: any) {
    if (!quote) return;
    const newLine: QuoteLine = {
      serviceKey: "",
      qty: 1,
      hours: 0,
      holidayHours: 0,
      travel: rateRow.travel ?? 0,
      baseHourly: rateRow.hourly ?? 0,
      baseDay: rateRow.day ?? 0,
      otRate: rateRow.ot_rate ?? 0,
      dtRate: rateRow.dt_rate ?? 0,
      rule: "",
      total: 0,
      positionId: rateRow.specialties?.position_id ?? undefined,
      specialtyId: rateRow.specialty_id ?? undefined,
      // Don't write the legacy denormalized text columns; display always
      // looks up by ID from the positions/specialties tables.
      quoteDate: day.date,
      startTime: day.startTime,
      endTime: day.endTime,
      rateMode: "hourly",
    };
    const newLines = [...quote.lines, newLine];
    const newTotal = money(recomputeTotals(newLines));
    const pct = quote.depositPct ?? 0;
    const newDeposit = money(newTotal * (pct / 100));
    setQuote({ ...quote, lines: newLines, total: newTotal, deposit: newDeposit });
    setAddLineOpen(null);
  }

  function copyFromPreviousDay(targetDay: DayInfo, prevDay: DayInfo) {
    if (!quote) return;
    const prevLines = quote.lines.filter((l) => l.quoteDate === prevDay.date);
    if (prevLines.length === 0) {
      alert(`No lines on ${prevDay.label} to copy.`);
      return;
    }
    const copies = prevLines.map((l) => ({
      ...l,
      quoteDate: targetDay.date,
      startTime: targetDay.startTime,
      endTime: targetDay.endTime,
    }));
    const newLines = [...quote.lines, ...copies];
    const newTotal = money(recomputeTotals(newLines));
    const pct = quote.depositPct ?? 0;
    const newDeposit = money(newTotal * (pct / 100));
    setQuote({ ...quote, lines: newLines, total: newTotal, deposit: newDeposit });
  }

  async function changeRateCard(newProfileId: string) {
    if (!quote || newProfileId === quote.rateCardProfileId) return;
    const ok = confirm(
      "Change the rate card? This will recalculate every line's rates from the new profile. " +
      "Lines whose position+specialty don't exist in the new profile will keep their old rates."
    );
    if (!ok) return;

    const rcRes = await supabase
      .from("rate_card_profile_rows")
      .select("*, specialties(id, name, position_id)")
      .eq("profile_id", newProfileId)
      .order("sort_order");
    const newRows = rcRes.data ?? [];

    const newLines = quote.lines.map((l) => {
      // Match by specialty_id alone — rate_card_profile_rows has no
      // position_id column (specialty implies position 1:1).
      const match = l.specialtyId
        ? newRows.find((r: any) => r.specialty_id === l.specialtyId)
        : undefined;
      if (!match) return l; // keep old rates, will be flagged in UI
      const merged: QuoteLine = {
        ...l,
        baseHourly: match.hourly ?? 0,
        baseDay: match.day ?? 0,
        otRate: match.ot_rate ?? 0,
        dtRate: match.dt_rate ?? 0,
      };
      merged.total = recomputeLineTotal(merged);
      return merged;
    });

    const newTotal = money(recomputeTotals(newLines));
    const pct = quote.depositPct ?? 0;
    const newDeposit = money(newTotal * (pct / 100));
    setRateCardRows(newRows);
    setQuote({
      ...quote,
      rateCardProfileId: newProfileId,
      lines: newLines,
      total: newTotal,
      deposit: newDeposit,
    });
  }

  // ── Actions ───────────────────────────────────────────────────────────────
  async function onSave() {
    if (!quote) return;
    setSaving("saving");
    try {
      await saveDraft(quote);
      setSaving("saved");
      setTimeout(() => setSaving("idle"), 2000);
    } catch (err: any) {
      setSaving("idle");
      alert(`Save failed: ${err.message || err}`);
    }
  }

  async function onIssue() {
    if (!quote) return;
    if (!confirm("Issue this quote? Once issued it becomes read-only and a permanent quote_no is assigned.")) return;
    try {
      await saveDraft(quote);
      await issueDraft(quote.id);
      router.push(`/quotes/${quote.id}`);
    } catch (err: any) {
      alert(`Issue failed: ${err.message || err}`);
    }
  }

  async function onDelete() {
    if (!quote) return;
    if (!confirm("Delete this draft? This cannot be undone.")) return;
    try {
      await deleteDraft(quote.id);
      router.push("/quotes");
    } catch (err: any) {
      alert(`Delete failed: ${err.message || err}`);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────
  if (loading) return <div className="muted">Loading…</div>;
  if (error) return <div className="muted">{error}</div>;
  if (!quote) return null;

  const projectedQuoteNo = job?.job_no
    ? quote.parentQuoteId && parentRevisionNo !== null
      ? `${job.job_no}_EST_REV${parentRevisionNo}`
      : `${job.job_no}_EST`
    : null;

  // Group lines by day. Lines whose quoteDate doesn't match any day go in "Unassigned".
  const linesByDay = new Map<string, Array<{ line: QuoteLine; globalIndex: number }>>();
  for (const d of days) linesByDay.set(d.date, []);
  const unassigned: Array<{ line: QuoteLine; globalIndex: number }> = [];
  quote.lines.forEach((line, i) => {
    if (line.quoteDate && linesByDay.has(line.quoteDate)) {
      linesByDay.get(line.quoteDate)!.push({ line, globalIndex: i });
    } else {
      unassigned.push({ line, globalIndex: i });
    }
  });

  // Track which lines reference a specialty that isn't in the current rate card.
  // Match by specialty_id alone — rate_card_profile_rows is keyed on specialty.
  const linesWithStaleRates = new Set<number>();
  if (rateCardRows.length > 0) {
    quote.lines.forEach((l, i) => {
      if (!l.specialtyId) return;
      const hasMatch = rateCardRows.some((r) => r.specialty_id === l.specialtyId);
      if (!hasMatch) linesWithStaleRates.add(i);
    });
  }

  const renderLineRow = (line: QuoteLine, globalIndex: number) => {
    // Specialty is authoritative — derive position from specialty.position_id
    // when present. Falls back to the line's own positionId for legacy lines.
    const lineSpecialty = line.specialtyId ? specialties.find((s) => s.id === line.specialtyId) : undefined;
    const effectivePositionId = lineSpecialty?.positionId ?? line.positionId;
    const lineSpecialties = effectivePositionId
      ? specialties.filter((s) => s.positionId === effectivePositionId)
      : [];
    return (
    <tr key={globalIndex} style={linesWithStaleRates.has(globalIndex) ? { background: "#fff8e1" } : undefined}>
      <td>
        <select
          value={effectivePositionId || ""}
          onChange={(e) => {
            // Picking position alone doesn't fully identify a rate — the user
            // still has to pick specialty next. Clear specialty since it's
            // position-scoped.
            updateLine(globalIndex, {
              positionId: e.target.value || undefined,
              specialtyId: undefined,
            });
          }}
          style={{ width: "100%", minWidth: 130 }}
        >
          <option value="">— Select —</option>
          {positions.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </td>
      <td>
        <select
          value={line.specialtyId || ""}
          onChange={(e) => {
            // Specialty is the authoritative FK — position is derived. We
            // intentionally don't write to the legacy department/specialty
            // text columns here; display always looks up by ID.
            const spc = specialties.find((s) => s.id === e.target.value);
            updateLine(globalIndex, {
              specialtyId: e.target.value || undefined,
              positionId: spc?.positionId ?? line.positionId,
            });
          }}
          disabled={!effectivePositionId}
          style={{ width: "100%", minWidth: 130 }}
        >
          <option value="">— Select —</option>
          {lineSpecialties.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </td>
      <td>
        <input
          type="text"
          value={line.shiftLabel || ""}
          onChange={(e) => updateLine(globalIndex, { shiftLabel: e.target.value })}
          placeholder="Shift"
          title="Free-text shift label, e.g. Load In, Show Call, Strike"
          style={{ width: "100%", minWidth: 90 }}
        />
      </td>
      <td><input className="num" type="number" value={line.qty} onChange={(e) => updateLine(globalIndex, { qty: parseFloat(e.target.value) || 0 })} style={{ width: 50 }} /></td>
      <td><input className="num" type="number" value={line.hours} onChange={(e) => updateLine(globalIndex, { hours: parseFloat(e.target.value) || 0 })} style={{ width: 60 }} step="0.5" /></td>
      <td><input className="num" type="number" value={line.holidayHours} onChange={(e) => updateLine(globalIndex, { holidayHours: parseFloat(e.target.value) || 0 })} style={{ width: 60 }} step="0.5" title="Hours billed at 2x the regular hourly rate" /></td>
      <td><input className="num" type="number" value={line.travel} onChange={(e) => updateLine(globalIndex, { travel: parseFloat(e.target.value) || 0 })} style={{ width: 60 }} step="0.01" title="Per-crew travel charge" /></td>
      <td><input className="num" type="number" value={line.baseHourly} onChange={(e) => updateLine(globalIndex, { baseHourly: parseFloat(e.target.value) || 0 })} style={{ width: 70 }} step="0.01" /></td>
      <td><input className="num" type="number" value={line.baseDay} onChange={(e) => updateLine(globalIndex, { baseDay: parseFloat(e.target.value) || 0 })} style={{ width: 70 }} step="0.01" /></td>
      <td><input className="num" type="number" value={line.otRate} onChange={(e) => updateLine(globalIndex, { otRate: parseFloat(e.target.value) || 0 })} style={{ width: 60 }} step="0.01" title="OT rate — informational; OT computed at timesheet time" /></td>
      <td><input className="num" type="number" value={line.dtRate} onChange={(e) => updateLine(globalIndex, { dtRate: parseFloat(e.target.value) || 0 })} style={{ width: 60 }} step="0.01" title="DT rate — informational; DT computed at timesheet time" /></td>
      <td>
        <select
          value={ruleToTriggerValue(line.rule)}
          onChange={(e) => {
            const opt = OT_TRIGGER_OPTIONS.find((o) => o.value === e.target.value);
            if (opt) updateLine(globalIndex, { rule: opt.rule });
          }}
          title="OT/DT trigger. Stored as the formatted rule string on the line."
          style={{ minWidth: 130 }}
        >
          {OT_TRIGGER_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </td>
      <td>
        <select
          value={line.rateMode || "hourly"}
          onChange={(e) => updateLine(globalIndex, { rateMode: e.target.value })}
          style={{ minWidth: 80 }}
        >
          <option value="hourly">hourly</option>
          <option value="day">day</option>
        </select>
      </td>
      <td style={{ fontVariantNumeric: "tabular-nums" }}>${line.total.toFixed(2)}</td>
      <td><button className="secondary" onClick={() => deleteLine(globalIndex)} style={{ fontSize: 12, padding: "4px 8px" }}>×</button></td>
    </tr>
  );
  };

  return (
    <div className="card">
      <div className="action-row" style={{ marginBottom: 12, alignItems: "baseline" }}>
        <h2 className="section-title" style={{ margin: 0, flex: 1 }}>
          {projectedQuoteNo ? <code>{projectedQuoteNo}</code> : "Draft Quote"}
          <span className="badge" style={{ marginLeft: 12 }}>Draft</span>
          {quote.parentQuoteId ? (
            <span className="muted" style={{ marginLeft: 8 }}>Revision of <Link href={`/quotes/${quote.parentQuoteId}`}>parent</Link></span>
          ) : null}
        </h2>
        <span className="muted">
          {saving === "saving" ? "Saving…" : saving === "saved" ? "Saved ✓" : ""}
        </span>
        <Link href="/quotes" className="badge">← All Quotes</Link>
      </div>
      <div className="muted" style={{ marginBottom: 12, fontSize: 13 }}>
        Projected quote # — finalized when you click Issue Quote. {!job?.job_no ? "Job has no job_no yet; finish the job request first." : null}
      </div>

      {/* Read-only event panel */}
      <div className="card" style={{ marginBottom: 16, background: "rgba(0,0,0,0.02)" }}>
        <div className="action-row" style={{ alignItems: "baseline", marginBottom: 8 }}>
          <h3 className="section-title" style={{ margin: 0, flex: 1 }}>Event details</h3>
          {job?.id ? <Link className="badge" href={`/job-requests?id=${job.id}`}>Edit on Job →</Link> : null}
        </div>
        {job ? (
          <div className="grid2">
            <div>
              <div className="muted">Client</div><div>{job.client}</div>
              <div className="muted" style={{ marginTop: 8 }}>Event</div><div>{job.event_name}</div>
              <div className="muted" style={{ marginTop: 8 }}>Venue</div>
              <div>{job.venue} {job.city_state ? <span className="muted">— {job.city_state}</span> : null}</div>
            </div>
            <div>
              <div className="muted">Dates</div>
              <div>{job.request_date}{job.end_date && job.end_date !== job.request_date ? ` → ${job.end_date}` : ""}</div>
              <div className="muted" style={{ marginTop: 8 }}>Job #</div>
              <div>{job.job_no || "—"}</div>
              <div className="muted" style={{ marginTop: 8 }}>Status</div>
              <div>{job.status}</div>
            </div>
          </div>
        ) : (
          <div className="muted">No job_request linked.</div>
        )}
      </div>

      {/* Totals summary — duplicated up top for long quotes where the user
          would otherwise have to scroll past every line to see the bottom. */}
      <div
        style={{
          marginBottom: 16,
          padding: "10px 14px",
          background: "#fbf4e8",
          border: "1px solid #d7c6aa",
          borderRadius: 8,
          display: "flex",
          gap: 24,
          flexWrap: "wrap",
          alignItems: "baseline",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        <div>
          <div className="muted" style={{ fontSize: 11 }}>Subtotal</div>
          <div style={{ fontSize: 18, fontWeight: 600 }}>${(quote.total ?? 0).toFixed(2)}</div>
        </div>
        <div>
          <div className="muted" style={{ fontSize: 11 }}>Deposit ({quote.depositPct ?? 0}%)</div>
          <div style={{ fontSize: 18, fontWeight: 600 }}>${(quote.deposit ?? 0).toFixed(2)}</div>
        </div>
        <div>
          <div className="muted" style={{ fontSize: 11 }}>Balance Due</div>
          <div style={{ fontSize: 18, fontWeight: 600 }}>
            ${(Math.round(((quote.total ?? 0) - (quote.deposit ?? 0)) * 100) / 100).toFixed(2)}
          </div>
        </div>
        <div style={{ marginLeft: "auto" }}>
          <div className="muted" style={{ fontSize: 11 }}>Lines</div>
          <div style={{ fontSize: 16 }}>{quote.lines.length}</div>
        </div>
      </div>

      {/* Quote-specific fields */}
      <div className="grid2" style={{ marginBottom: 16 }}>
        <div>
          <label>
            <div className="muted">Rate Card Profile</div>
            <select
              value={quote.rateCardProfileId || ""}
              onChange={(e) => changeRateCard(e.target.value)}
            >
              {allProfiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}{p.client_name ? ` — ${p.client_name}` : ""}
                  {p.effective_date ? ` (${p.effective_date})` : ""}
                </option>
              ))}
            </select>
          </label>
          <label style={{ marginTop: 8, display: "block" }}>
            <div className="muted">Deposit %</div>
            <input
              type="number"
              min={0}
              max={100}
              step={1}
              value={quote.depositPct ?? 0}
              onChange={(e) => {
                const pct = Math.max(0, Math.min(100, parseFloat(e.target.value) || 0));
                updateQuote({
                  depositPct: pct,
                  deposit: money(quote.total * (pct / 100)),
                });
              }}
              title="Percentage of subtotal. The $ amount is computed and updates as lines are edited."
              style={{ maxWidth: 120 }}
            />
            <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
              = ${(quote.deposit ?? 0).toFixed(2)}
            </div>
          </label>
          <label style={{ marginTop: 8 }}>
            <div className="muted">Notes</div>
            <textarea value={quote.notes} onChange={(e) => updateQuote({ notes: e.target.value })} rows={3} />
          </label>
        </div>
        <div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <label>
              <div className="muted">Prepared by — name</div>
              <input
                type="text"
                value={quote.preparedByName || ""}
                onChange={(e) => updateQuote({ preparedByName: e.target.value })}
                placeholder="Your name"
              />
            </label>
            <label>
              <div className="muted">Prepared by — title</div>
              <input
                type="text"
                value={quote.preparedByTitle || ""}
                onChange={(e) => updateQuote({ preparedByTitle: e.target.value })}
                placeholder="Your title"
              />
            </label>
          </div>
          <label style={{ marginTop: 8 }}>
            <div className="muted">Signature name (typed by signer at issue)</div>
            <input
              type="text"
              value={quote.signatureName || ""}
              onChange={(e) => updateQuote({ signatureName: e.target.value })}
              placeholder="(blank — populated when client signs)"
            />
          </label>
          <label style={{ marginTop: 8 }}>
            <div className="muted">Terms</div>
            <textarea value={quote.terms} onChange={(e) => updateQuote({ terms: e.target.value })} rows={6} />
          </label>
        </div>
      </div>

      {/* Lines per day */}
      <div className="action-row" style={{ alignItems: "baseline", marginBottom: 8 }}>
        <h3 className="section-title" style={{ margin: 0, flex: 1 }}>Line items</h3>
        {days.length > 1 ? (
          <>
            <button
              className="secondary"
              onClick={() => setCollapsedDays(new Set(days.map((d) => d.id)))}
              style={{ fontSize: 12 }}
            >
              Collapse all
            </button>
            <button
              className="secondary"
              onClick={() => setCollapsedDays(new Set())}
              style={{ fontSize: 12 }}
            >
              Expand all
            </button>
          </>
        ) : null}
      </div>
      {linesWithStaleRates.size > 0 ? (
        <div className="muted" style={{ background: "#fff8e1", padding: 8, borderRadius: 6, marginBottom: 8, fontSize: 13 }}>
          ⚠ {linesWithStaleRates.size} line(s) have positions that don't exist in the current rate card profile. They keep their existing rates (highlighted in yellow).
        </div>
      ) : null}

      {days.map((day, dayIndex) => {
        const dayLines = linesByDay.get(day.date) ?? [];
        const prevDay = dayIndex > 0 ? days[dayIndex - 1] : null;
        const isCollapsed = collapsedDays.has(day.id);
        const dayTotal = dayLines.reduce((s, { line }) => s + (line.total || 0), 0);
        return (
          <div key={day.id} className="card" style={{ marginBottom: 12, background: "rgba(0,0,0,0.015)" }}>
            <div className="action-row" style={{ marginBottom: isCollapsed ? 0 : 8, alignItems: "baseline" }}>
              <button
                onClick={() => toggleDayCollapsed(day.id)}
                style={{
                  background: "none", border: "none", padding: 0, marginRight: 8,
                  cursor: "pointer", fontSize: 14, color: "inherit",
                }}
                title={isCollapsed ? "Expand" : "Collapse"}
              >
                {isCollapsed ? "▶" : "▼"}
              </button>
              <h4 style={{ margin: 0, flex: 1 }}>
                {day.label}
                <span className="muted" style={{ marginLeft: 8, fontSize: 13, fontWeight: "normal" }}>
                  · {dayLines.length} line{dayLines.length === 1 ? "" : "s"} · ${dayTotal.toFixed(2)}
                </span>
              </h4>
              {!isCollapsed && prevDay && dayLines.length === 0 ? (
                <button className="secondary" onClick={() => copyFromPreviousDay(day, prevDay)} style={{ fontSize: 12 }}>
                  Copy from {prevDay.label}
                </button>
              ) : null}
              {!isCollapsed ? (
                <button className="secondary" onClick={() => setAddLineOpen(addLineOpen === day.id ? null : day.id)} style={{ fontSize: 12 }}>
                  {addLineOpen === day.id ? "Cancel" : "+ Add Line"}
                </button>
              ) : null}
            </div>
            {!isCollapsed && addLineOpen === day.id ? (
              <div style={{ marginBottom: 8, padding: 8, background: "#fff", borderRadius: 6, border: "1px solid #d7c6aa" }}>
                <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>Pick a position from the rate card:</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 200, overflowY: "auto" }}>
                  {rateCardRows.length === 0 ? (
                    <div className="muted" style={{ fontSize: 12 }}>No rate card rows loaded.</div>
                  ) : rateCardRows.map((rr: any) => {
                    const posName = rr.specialties?.positions?.name ?? "(unknown)";
                    const spcName = rr.specialties?.name ?? "(no specialty)";
                    return (
                      <button
                        key={rr.id}
                        className="secondary"
                        onClick={() => addLine(day, rr)}
                        style={{ textAlign: "left", fontSize: 13, padding: "4px 8px" }}
                      >
                        {posName} — {spcName} <span className="muted">(${rr.hourly}/hr · ${rr.day}/day)</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}
            {!isCollapsed ? (
              dayLines.length === 0 ? (
                <div className="muted" style={{ fontSize: 13 }}>No lines for this day yet.</div>
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table>
                    <thead>
                      <tr>
                        <th>Department</th><th>Specialty</th><th>Shift</th>
                        <th>Qty</th><th>Hours</th><th>Holiday</th><th>Travel</th>
                        <th>$/hr</th><th>$/day</th><th>OT</th><th>DT</th>
                        <th>Rule</th><th>Mode</th><th>Total</th><th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {dayLines.map(({ line, globalIndex }) => renderLineRow(line, globalIndex))}
                    </tbody>
                  </table>
                </div>
              )
            ) : null}
          </div>
        );
      })}

      {unassigned.length > 0 ? (
        <div className="card" style={{ marginBottom: 12, background: "#fff8e1" }}>
          <h4 style={{ marginTop: 0 }}>Unassigned (no day match)</h4>
          <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
            These lines have a quote_date that doesn't match any day on the job. Edit each line's date or delete.
          </div>
          <div style={{ overflowX: "auto" }}>
            <table>
              <thead>
                <tr><th>Department</th><th>Specialty</th><th>Date</th><th>Qty</th><th>Hours</th><th>$/hr</th><th>Total</th><th></th></tr>
              </thead>
              <tbody>
                {unassigned.map(({ line, globalIndex }) => (
                  <tr key={globalIndex}>
                    <td><input type="text" value={line.department || ""} onChange={(e) => updateLine(globalIndex, { department: e.target.value })} placeholder="Position" style={{ width: "100%", minWidth: 120 }} /></td>
                    <td><input type="text" value={line.specialty || ""} onChange={(e) => updateLine(globalIndex, { specialty: e.target.value })} placeholder="Specialty" style={{ width: "100%", minWidth: 120 }} /></td>
                    <td><input type="date" value={line.quoteDate || ""} onChange={(e) => updateLine(globalIndex, { quoteDate: e.target.value })} /></td>
                    <td><input type="number" value={line.qty} onChange={(e) => updateLine(globalIndex, { qty: parseFloat(e.target.value) || 0 })} style={{ width: 60 }} /></td>
                    <td><input type="number" value={line.hours} onChange={(e) => updateLine(globalIndex, { hours: parseFloat(e.target.value) || 0 })} style={{ width: 70 }} /></td>
                    <td><input type="number" value={line.baseHourly} onChange={(e) => updateLine(globalIndex, { baseHourly: parseFloat(e.target.value) || 0 })} style={{ width: 80 }} step="0.01" /></td>
                    <td>${line.total.toFixed(2)}</td>
                    <td><button className="secondary" onClick={() => deleteLine(globalIndex)} style={{ fontSize: 12 }}>×</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      <div className="grid2" style={{ marginBottom: 16 }}>
        <div></div>
        <div style={{ fontVariantNumeric: "tabular-nums" }}>
          <div className="action-row">
            <div className="muted" style={{ flex: 1 }}>Subtotal</div>
            <div>${(quote.total ?? 0).toFixed(2)}</div>
          </div>
          <div className="action-row">
            <div className="muted" style={{ flex: 1 }}>Deposit ({quote.depositPct ?? 0}%)</div>
            <div>${(quote.deposit ?? 0).toFixed(2)}</div>
          </div>
          <div className="action-row" style={{ borderTop: "1px solid #d7c6aa", paddingTop: 4, marginTop: 4 }}>
            <div className="muted" style={{ flex: 1 }}>Balance due</div>
            <div>${money((quote.total ?? 0) - (quote.deposit ?? 0)).toFixed(2)}</div>
          </div>
        </div>
      </div>

      <div className="action-row">
        <button onClick={onSave} disabled={saving === "saving"}>
          {saving === "saving" ? "Saving…" : "Save Draft"}
        </button>
        <button onClick={onIssue}>Issue Quote</button>
        <button className="secondary" onClick={onDelete}>Delete</button>
      </div>
    </div>
  );
}
