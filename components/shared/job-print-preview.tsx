"use client";

/**
 * Print PREVIEW shell for the job-level documents — reached at
 * /job-requests/[id]/print?doc=…
 *
 * Adopts the pattern quotes, invoices and payroll already use: a standalone
 * route (no AppShell) showing exactly what will print, with a toolbar of
 * options above it and a Print button. Options live in the URL so a particular
 * view can be linked, reloaded, or sent to someone.
 *
 * WHY THIS REPLACED THE OLD MECHANISM (and why it is simpler, not richer):
 * the job screen used to render all three documents `display:none`, then set a
 * body class (`printing-signin`, `printing-schedule`) for one print run so
 * @media print could reveal exactly one and hide the others. That meant nobody
 * could see a document before committing it to paper, every new artifact added
 * another body class and another "hide the other sheets" rule, and the
 * documents' entire styling lived inside @media print where it could not be
 * inspected. A route that renders ONE document has nothing to hide, so the
 * body-class machinery is gone.
 */

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import { loadJobRequestDays } from "@/lib/storage/job-request-days";
import { CrewScheduleReport } from "./crew-schedule-report";
import { CrewSignInSheet } from "./crew-sign-in-sheet";
import { JobPrintSheet } from "./job-print-sheet";
import { TimesheetActualsSheet } from "./timesheet-actuals-sheet";
import { printWithTitle } from "@/lib/print-with-title";
import { parsePrintSort, PRINT_SORT_LABEL, type PrintSort } from "@/lib/jobs/print-format";
import type { JobRequest, JobRequestDay } from "@/lib/store/types";

export type PrintDoc = "schedule" | "signin" | "actuals" | "summary";

const DOC_LABEL: Record<PrintDoc, string> = {
  schedule: "Crew Schedule",
  signin: "Crew Sign-In Sheet",
  actuals: "Timesheet (Actuals)",
  summary: "Job Summary",
};

/** What each document is FOR — stated on screen, because #46's whole premise is
 *  that three similar-looking papers get confused with each other. */
const DOC_PURPOSE: Record<PrintDoc, string> = {
  schedule: "BEFORE the job — the crew leader's reference. Reading only; nothing is written on it.",
  signin: "DURING the job — the capture form crew sign. Blank time and signature boxes.",
  actuals: "AFTER the job — the record of hours actually worked, with the signatures captured at the Time Clock. No blank boxes.",
  summary: "The job record — venue, daily requirements, assigned crew, notes.",
};

export default function JobPrintPreview({ id }: { id: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const doc = (searchParams.get("doc") as PrintDoc) || "schedule";
  const day = searchParams.get("day") || "all";
  // Default ON: a sheet that silently omits people is worse than a noisy one.
  const includeUnassigned = searchParams.get("unassigned") !== "0";
  const blankRows = Math.max(0, Math.min(20, Number(searchParams.get("blanks") ?? 0) || 0));
  const sort: PrintSort = parsePrintSort(searchParams.get("sort"));

  const [job, setJob] = useState<JobRequest | null>(null);
  const [days, setDays] = useState<JobRequestDay[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [jobRes, ds] = await Promise.all([
          supabase.from("job_requests").select("*").eq("id", id).maybeSingle(),
          loadJobRequestDays(id),
        ]);
        if (cancelled) return;
        const r: any = jobRes.data;
        if (r) {
          setJob({
            id: r.id,
            clientId: r.client_id ?? undefined,
            client: r.client ?? "",
            eventName: r.event_name ?? "",
            venue: r.venue ?? "",
            venueAddress: r.venue_address ?? "",
            venueAddress2: r.venue_address_2 ?? undefined,
            venueZip: r.venue_zip ?? undefined,
            city: r.city ?? "",
            state: r.state ?? "",
            cityState: r.city_state ?? "",
            receivedDate: r.received_date ?? "",
            requestDate: r.request_date ?? "",
            endDate: r.end_date ?? "",
            startTime: r.start_time ?? "",
            endTime: r.end_time ?? "",
            expectedHours: r.expected_hours ?? undefined,
            addToCalendar: !!r.add_to_calendar,
            status: r.status ?? "",
            notes: r.notes ?? "",
            packetNotes: r.packet_notes ?? "",
            attachmentNames: [],
            jobNo: r.job_no ?? undefined,
            eventAbbr: r.event_abbr ?? undefined,
          } as JobRequest);
        }
        setDays(ds);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [id]);

  /** Rewrite one URL param, preserving the rest. */
  function setParam(key: string, value: string | null) {
    const p = new URLSearchParams(searchParams?.toString() ?? "");
    if (value === null || value === "") p.delete(key);
    else p.set(key, value);
    router.replace(`/job-requests/${encodeURIComponent(id)}/print?${p.toString()}`);
  }

  const dayOptions = useMemo(
    () => days.map((d) => d.eventDate).filter(Boolean).sort(),
    [days],
  );

  // #71 (print part): the schedule and sign-in sheet print EXPECTED times, so a
  // day in the selection with no time window is a hard stop — not a warning.
  // (The old #38 confirm in lib/jobs/confirm-sign-in-sheet-print.ts was never
  // wired to this route — #70 — and is removed.)
  const needsWindow = doc === "schedule" || doc === "signin";
  const daysMissingWindow = needsWindow
    ? days
        .filter((d) => day === "all" || d.eventDate === day)
        .filter((d) => !(d.startTime && d.endTime) && !(d.startTime2 && d.endTime2))
        .map((d) => d.eventDate)
        .sort()
    : [];
  const blocked = daysMissingWindow.length > 0;

  // Remember the last document chosen, so the job's single Print button (#86)
  // reopens on it.
  useEffect(() => {
    try { localStorage.setItem("aos.jobPrint.lastDoc", doc); } catch { /* storage unavailable */ }
  }, [doc]);

  if (loading) return <div style={{ padding: 24, fontFamily: "system-ui, sans-serif" }}>Loading…</div>;
  if (!job) return <div style={{ padding: 24, fontFamily: "system-ui, sans-serif" }}>Job not found.</div>;

  // #78: Sign-In and Actuals are wide two-row forms and must be landscape; the
  // schedule follows so the set prints the same way. Stated on the route
  // itself rather than inherited from the app-wide rule, which Safari did not
  // apply here. The summary keeps the app default.
  const landscape = doc !== "summary";

  function doPrint() {
    if (blocked || !job) return;
    // #83: a real filename instead of "Amplified Operations Suite.pdf".
    printWithTitle([DOC_LABEL[doc], job.jobNo, job.eventName, day === "all" ? "All days" : day]);
  }

  return (
    <div className={`print-preview-page${landscape ? " is-landscape" : ""}`}>
      {landscape && (
        // @page can't live in styled-jsx or be scoped by class, so it goes in a
        // plain <style> that only exists while a landscape document is shown.
        <style>{`@page { size: landscape; margin: 0.3in; }`}</style>
      )}
      {/* ─── Toolbar (never printed) ─────────────────────────────────────── */}
      <div className="print-actions hide-print">
        <div className="ppa-row">
          <a href={`/job-requests/${encodeURIComponent(id)}`} className="ppa-back">← Back to job</a>
          <button onClick={doPrint} className="ppa-print" disabled={blocked}
            title={blocked ? "Set start/end times for the listed days first" : undefined}>
            Print / Save as PDF
          </button>
          <span className="ppa-title" title={DOC_PURPOSE[doc]}>{DOC_LABEL[doc]}</span>
        </div>

        <div className="ppa-row">
          <label>
            Document:{" "}
            <select value={doc} onChange={(e) => setParam("doc", e.target.value)}>
              <option value="schedule">Crew Schedule (before)</option>
              <option value="signin">Crew Sign-In Sheet (during)</option>
              <option value="actuals">Timesheet — Actuals (after)</option>
              <option value="summary">Job Summary</option>
            </select>
          </label>

          {doc !== "summary" && (
            <label>
              Day:{" "}
              <select value={day} onChange={(e) => setParam("day", e.target.value === "all" ? null : e.target.value)}>
                <option value="all">All days ({dayOptions.length})</option>
                {dayOptions.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </label>
          )}

          {(doc === "schedule" || doc === "signin") && (
            <label className="ppa-check" title="Off hides rows with no employee picked and rows not yet confirmed. Default on — a sheet that silently omits people is worse than a noisy one.">
              <input
                type="checkbox"
                checked={includeUnassigned}
                onChange={(e) => setParam("unassigned", e.target.checked ? null : "0")}
              />
              Include unassigned &amp; unconfirmed
            </label>
          )}

          {doc !== "summary" && (
            <label>
              Sort:{" "}
              <select value={sort} onChange={(e) => setParam("sort", e.target.value === "last" ? null : e.target.value)}>
                {(Object.keys(PRINT_SORT_LABEL) as PrintSort[]).map((s) => (
                  <option key={s} value={s}>{PRINT_SORT_LABEL[s]}</option>
                ))}
              </select>
            </label>
          )}

          {doc === "signin" && (
            <label title="Extra empty rows for walk-ups and last-minute replacements.">
              Blank rows:{" "}
              <select value={String(blankRows)} onChange={(e) => setParam("blanks", e.target.value === "0" ? null : e.target.value)}>
                {[0, 2, 5, 10].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
          )}
        </div>

        {/* #96: purpose + "Save as PDF" tip moved to tooltips / the help guide. */}
        {blocked && (
          <div className="ppa-blocked">
            Can&apos;t print — no start/end times on {daysMissingWindow.join(", ")}.{" "}
            <a href={`/job-requests/${encodeURIComponent(id)}`}>Set them on Daily Requirements</a>
          </div>
        )}
      </div>

      {/* ─── The document itself ─────────────────────────────────────────── */}
      <div className="print-preview-paper">
        {doc === "schedule" && (
          <CrewScheduleReport form={job} dayFilter={day} includeUnassigned={includeUnassigned} sort={sort} />
        )}
        {doc === "signin" && (
          <CrewSignInSheet form={job} dayFilter={day} includeUnassigned={includeUnassigned} blankRows={blankRows} sort={sort} />
        )}
        {doc === "actuals" && <TimesheetActualsSheet form={job} dayFilter={day} sort={sort} />}
        {doc === "summary" && <JobPrintSheet form={job} />}
      </div>
    </div>
  );
}
