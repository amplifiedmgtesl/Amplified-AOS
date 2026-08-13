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

  if (loading) return <div style={{ padding: 24, fontFamily: "system-ui, sans-serif" }}>Loading…</div>;
  if (!job) return <div style={{ padding: 24, fontFamily: "system-ui, sans-serif" }}>Job not found.</div>;

  return (
    <div className="print-preview-page">
      {/* ─── Toolbar (never printed) ─────────────────────────────────────── */}
      <div className="print-actions hide-print">
        <div className="ppa-row">
          <a href={`/job-requests/${encodeURIComponent(id)}`} className="ppa-back">← Back to job</a>
          <button onClick={() => window.print()} className="ppa-print">Print / Save as PDF</button>
          <span className="ppa-title">{DOC_LABEL[doc]}</span>
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

          {doc === "signin" && (
            <label title="Extra empty rows for walk-ups and last-minute replacements — the people most likely to be added on the day, and currently invisible on every printed sheet (backlog #48).">
              Blank rows:{" "}
              <select value={String(blankRows)} onChange={(e) => setParam("blanks", e.target.value === "0" ? null : e.target.value)}>
                {[0, 2, 5, 10].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
          )}
        </div>

        <div className="ppa-purpose">{DOC_PURPOSE[doc]}</div>
        <div className="ppa-tip">
          Tip: in the print dialog choose &quot;Save as PDF&quot; and uncheck &quot;Headers and footers&quot;.
        </div>
      </div>

      {/* ─── The document itself ─────────────────────────────────────────── */}
      <div className="print-preview-paper">
        {doc === "schedule" && (
          <CrewScheduleReport form={job} dayFilter={day} includeUnassigned={includeUnassigned} />
        )}
        {doc === "signin" && (
          <CrewSignInSheet form={job} dayFilter={day} includeUnassigned={includeUnassigned} blankRows={blankRows} />
        )}
        {doc === "actuals" && <TimesheetActualsSheet form={job} dayFilter={day} />}
        {doc === "summary" && <JobPrintSheet form={job} />}
      </div>
    </div>
  );
}
