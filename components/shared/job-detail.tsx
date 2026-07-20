"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { upsertJobRequest, deleteJobRequest, loadJobRequests } from "@/lib/store/app-store";
import { createDraftFromJob, pickRateCardForJob, loadJobQuoteState } from "@/lib/store/quotes";
import { googleCalendarLink } from "@/lib/store/calendar";
import { timeOptions } from "@/lib/store/timekeeping";
import { supabase } from "@/lib/supabase/client";
import { US_STATES, JOB_REQUEST_STATUSES } from "@/lib/constants";
import { JobRequestAttachmentsSection } from "./job-request-attachments-section";
import { JobRequestDaysSection } from "./job-request-days-section";
import { JobRequestCrewSection } from "./job-request-crew-section";
import { JobRequestShiftsSection } from "./job-request-shifts-section";
import { JobHealthSection, useJobHealthCount } from "./job-health-section";
import { JobPrintSheet } from "./job-print-sheet";
import { CrewSignInSheet } from "./crew-sign-in-sheet";
import { loadJobRequestDays } from "@/lib/storage/job-request-days";
import { useUserRole } from "@/lib/auth/use-user-role";
import { computeJobNo, defaultEventAbbr, sanitizeEventAbbr } from "@/lib/jobs/job-no";
import { printWithTitle } from "@/lib/print-with-title";
import type { JobRequest, Client } from "@/lib/store/types";

const TIMES = timeOptions();

function today() { return new Date().toISOString().slice(0, 10); }

const BLANK: JobRequest = {
  id: "", clientId: "", client: "", eventName: "", venue: "", venueAddress: "", venueAddress2: "",
  venueZip: "", city: "", state: "", cityState: "",
  receivedDate: today(), requestDate: "", endDate: "",
  startTime: "", endTime: "", expectedHours: 10, addToCalendar: true,
  status: "lead", notes: "", attachmentNames: [], packetNotes: "",
  jobNo: undefined, eventAbbr: undefined,
};

type SectionTab = "daily" | "crew" | "shifts" | "attachments" | "health";

/**
 * Standalone job detail — the full-page record view reached from the jobs
 * list. Mirrors the quotes/invoices flow (list and record on separate routes).
 * When `jobId` is omitted the form starts blank ("+ New"/deep-link new flow)
 * and redirects to {basePath}/{id} once saved.
 *
 * `basePath` keeps the back link, post-save and post-delete navigation inside
 * the admin app (/job-requests) or the crew-leader app (/lead/jobs).
 */
export default function JobDetail({
  jobId,
  basePath = "/job-requests",
}: {
  jobId?: string;
  basePath?: string;
}) {
  const router = useRouter();
  const isNew = !jobId;

  const [refreshKey, setRefreshKey] = useState(0);
  const rows = useMemo(() => loadJobRequests(), [refreshKey]);

  const [form, setForm] = useState<JobRequest>({ ...BLANK });
  const [notFound, setNotFound] = useState(false);
  const editingId = isNew ? null : jobId!;

  // Load the requested job into the form. For new, start from BLANK and honor
  // a ?clientId= prefill + ?tab= anchor (deep-links from Client Maintenance and
  // the health banners). Runs once per jobId.
  const [seeded, setSeeded] = useState(false);
  useEffect(() => {
    setSeeded(false);
    if (isNew) {
      let clientId = "", clientName = "";
      let wantTab: string | null = null;
      if (typeof window !== "undefined") {
        const params = new URLSearchParams(window.location.search);
        clientId = params.get("clientId") ?? "";
        wantTab = params.get("tab");
      }
      setForm({ ...BLANK, clientId });
      if (clientId) setPendingClientName(clientId);
      if (wantTab === "daily" || wantTab === "crew" || wantTab === "shifts" || wantTab === "attachments" || wantTab === "health") {
        setSectionTab(wantTab);
      }
      setNotFound(false);
      setSeeded(true);
      return;
    }
    const target = loadJobRequests().find((r) => r.id === jobId);
    if (target) {
      setForm({ ...target });
      setNotFound(false);
      if (typeof window !== "undefined") {
        const wantTab = new URLSearchParams(window.location.search).get("tab");
        if (wantTab === "daily" || wantTab === "crew" || wantTab === "shifts" || wantTab === "attachments" || wantTab === "health") {
          setSectionTab(wantTab);
        }
      }
    } else {
      setNotFound(true);
    }
    setSeeded(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId, isNew]);

  // Possible-duplicate detection: same client + same start date as an existing
  // job. Soft warning only. Excludes the row currently being edited.
  const possibleDuplicates = useMemo(() => {
    if (!form.clientId || !form.requestDate) return [];
    const selfId = form.id || "";
    return rows.filter((r) =>
      r.id !== selfId &&
      r.clientId === form.clientId &&
      r.requestDate === form.requestDate,
    );
  }, [rows, form.clientId, form.requestDate, form.id]);

  // Date extent of this job's day rows — warns when the header range no longer
  // covers them. Loaded lazily when editing an existing job.
  const [dayExtent, setDayExtent] = useState<{ min: string; max: string } | null>(null);
  useEffect(() => {
    if (!editingId) { setDayExtent(null); return; }
    let cancelled = false;
    (async () => {
      try {
        const days = await loadJobRequestDays(editingId);
        if (cancelled) return;
        const dates = days.map((d) => d.eventDate).filter(Boolean).sort();
        setDayExtent(dates.length > 0 ? { min: dates[0], max: dates[dates.length - 1] } : null);
      } catch (err) {
        console.error("[job-detail] loadJobRequestDays for header warning:", err);
      }
    })();
    return () => { cancelled = true; };
  }, [editingId, refreshKey]);

  const [shiftCount, setShiftCount] = useState<number | null>(null);
  useEffect(() => {
    if (!editingId) { setShiftCount(null); return; }
    let cancelled = false;
    (async () => {
      try {
        const { count, error } = await supabase
          .from("job_request_shifts")
          .select("id", { count: "exact", head: true })
          .eq("job_request_id", editingId)
          .eq("is_active", true);
        if (cancelled) return;
        if (error) { console.error("[job-detail] shift count:", error); return; }
        setShiftCount(count ?? 0);
      } catch (err) {
        console.error("[job-detail] shift count load:", err);
      }
    })();
    return () => { cancelled = true; };
  }, [editingId, refreshKey]);

  const headerDaysMismatch = useMemo(() => {
    if (!dayExtent) return null;
    const headerStart = form.requestDate;
    const headerEnd = form.endDate || form.requestDate;
    const issues: string[] = [];
    if (headerStart && dayExtent.min < headerStart) {
      issues.push(`Day rows exist on ${dayExtent.min} — earlier than the header start (${headerStart}).`);
    }
    if (headerEnd && dayExtent.max > headerEnd) {
      issues.push(`Day rows exist on ${dayExtent.max} — later than the header end (${headerEnd}).`);
    }
    return issues.length > 0 ? issues : null;
  }, [dayExtent, form.requestDate, form.endDate]);

  const [msg, setMsg] = useState("");
  const [clients, setClients] = useState<Client[]>([]);
  const [pendingClientName, setPendingClientName] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleteMsg, setDeleteMsg] = useState<string | null>(null);
  const [sectionTab, setSectionTab] = useState<SectionTab>("daily");
  const healthCounts = useJobHealthCount(editingId ? form : null, refreshKey);
  const role = useUserRole();
  const isCrewLeader = role === "crew_leader";
  // Payroll gets a read-only view: every field disabled, no save/delete/quote
  // actions. Print buttons stay — that's the point of letting them in.
  const isPayroll = role === "payroll";
  const timesheetHref = isCrewLeader ? "/lead/timekeeping" : "/timekeeping";

  const [openDraftId, setOpenDraftId] = useState<string | null>(null);
  const [latestIssuedId, setLatestIssuedId] = useState<string | null>(null);
  const [applicableRateCardLabel, setApplicableRateCardLabel] = useState<string>("");
  const [allRateCardProfiles, setAllRateCardProfiles] = useState<Array<{ id: string; name: string; client_name: string | null; effective_date: string | null }>>([]);

  useEffect(() => {
    supabase
      .from("rate_card_profiles")
      .select("id, name, client_name, effective_date")
      .order("client_name", { ascending: true, nullsFirst: false })
      .order("name")
      .then(({ data }) => setAllRateCardProfiles(data ?? []));
  }, []);

  useEffect(() => {
    if (!editingId) { setOpenDraftId(null); setLatestIssuedId(null); return; }
    let cancelled = false;
    loadJobQuoteState(editingId)
      .then(({ openDraftId, latestIssuedId }) => {
        if (cancelled) return;
        setOpenDraftId(openDraftId);
        setLatestIssuedId(latestIssuedId);
      })
      .catch((error) => console.error("[job-detail] quote state load failed:", error));
    return () => { cancelled = true; };
  }, [editingId, refreshKey]);

  useEffect(() => {
    if (!form.clientId || !form.requestDate) { setApplicableRateCardLabel(""); return; }
    let cancelled = false;
    (async () => {
      try {
        const card = await pickRateCardForJob(form.clientId, form.requestDate);
        if (cancelled) return;
        if (!card) { setApplicableRateCardLabel("(no rate card)"); return; }
        const profileRes = await supabase
          .from("rate_card_profiles")
          .select("name, client_name, effective_date")
          .eq("id", card.id)
          .maybeSingle();
        if (cancelled) return;
        const p = profileRes.data;
        if (!p) { setApplicableRateCardLabel(card.id); return; }
        const parts: string[] = [];
        if (p.client_name) parts.push(p.client_name);
        parts.push(p.name);
        const label = parts.join(" — ");
        setApplicableRateCardLabel(p.effective_date ? `${label} (eff ${p.effective_date})` : label);
      } catch (err) {
        console.error("[job-detail] rate card lookup failed:", err);
        setApplicableRateCardLabel("");
      }
    })();
    return () => { cancelled = true; };
  }, [form.clientId, form.requestDate]);

  useEffect(() => {
    supabase.from("clients").select("id, name, code, is_active").order("name")
      .then(({ data }) => setClients((data ?? []).map((r: any) => ({
        id: r.id, name: r.name, code: r.code ?? undefined, isActive: !!r.is_active,
      }))));
  }, []);

  const clientById = useMemo(() => {
    const map = new Map<string, Client>();
    for (const c of clients) map.set(c.id, c);
    return map;
  }, [clients]);

  // Resolve the prefilled client name for new jobs once clients load.
  useEffect(() => {
    if (!pendingClientName) return;
    const c = clientById.get(pendingClientName);
    if (c) { setForm((f) => ({ ...f, client: c.name })); setPendingClientName(null); }
  }, [pendingClientName, clientById]);

  const activeClients = useMemo(() => clients.filter((c) => c.isActive), [clients]);

  function selectClient(clientId: string) {
    const c = clientById.get(clientId);
    setForm((f) => ({ ...f, clientId, client: c?.name ?? "" }));
  }

  function mapAddress(r: JobRequest): string {
    return [r.venueAddress, r.venueAddress2, r.city, r.state, r.venueZip].filter(Boolean).join(", ");
  }

  function normalized(next: JobRequest): JobRequest {
    return { ...next, cityState: [next.city, next.state].filter(Boolean).join(", ") };
  }

  async function requestDelete() {
    if (!editingId) return;
    setDeleteMsg(null);
    const [qRes, ceRes, jcRes] = await Promise.all([
      supabase.from("quotes").select("id", { count: "exact", head: true }).eq("linked_job_request_id", editingId),
      supabase.from("calendar_events").select("id", { count: "exact", head: true }).eq("linked_job_request_id", editingId),
      supabase.from("job_costing_drafts").select("id", { count: "exact", head: true }).eq("linked_job_request_id", editingId),
    ]);
    const qCount = qRes.count ?? 0;
    const ceCount = ceRes.count ?? 0;
    const jcCount = jcRes.count ?? 0;
    const msgs: string[] = [];
    if (qCount > 0) msgs.push(`${qCount} quote${qCount !== 1 ? "s" : ""}`);
    if (ceCount > 0) msgs.push(`${ceCount} calendar event${ceCount !== 1 ? "s" : ""}`);
    if (jcCount > 0) msgs.push(`${jcCount} job costing draft${jcCount !== 1 ? "s" : ""}`);
    if (msgs.length > 0) {
      setDeleteMsg(`Cannot delete "${form.eventName || "(no event name)"}" — ${msgs.join(" and ")} reference this job. Remove or unlink them first.`);
      return;
    }
    setConfirmDeleteId(editingId);
  }

  async function confirmDelete() {
    if (!confirmDeleteId) return;
    const err = await deleteJobRequest(confirmDeleteId);
    setConfirmDeleteId(null);
    if (err) { setDeleteMsg(err); return; }
    router.push(basePath);
  }

  function confirmIfDuplicates(): boolean {
    if (possibleDuplicates.length === 0) return true;
    const lines = possibleDuplicates.map((d) => {
      const code = clientById.get(d.clientId)?.code ?? "";
      return `  • ${d.eventName || "(no event name)"} — ${code} · ${d.requestDate}${d.endDate && d.endDate !== d.requestDate ? `–${d.endDate}` : ""}${d.status ? ` · ${d.status}` : ""}`;
    });
    return confirm(
      `Possible duplicate${possibleDuplicates.length === 1 ? "" : "s"} — this client already has a job starting ${form.requestDate}:\n\n${lines.join("\n")}\n\nSave anyway? (Legitimate cases include multiple stages at the same venue on the same day.)`
    );
  }

  function validate(): boolean {
    if (!form.clientId) { setMsg("Please select a client before saving."); return false; }
    if (!form.eventName.trim()) { setMsg("Please enter an event name before saving."); return false; }
    if (!form.requestDate) { setMsg("Please pick an event start date before saving."); return false; }
    if (form.endDate && form.endDate < form.requestDate) { setMsg("End date can't be before the start date."); return false; }
    if (!confirmIfDuplicates()) return false;
    return true;
  }

  function buildRow(): JobRequest {
    return normalized({
      ...form,
      id: form.id || `jobreq-${Date.now()}`,
      eventAbbr: effectiveEventAbbr || undefined,
      jobNo: liveJobNo || undefined,
    });
  }

  function save() {
    if (!validate()) return;
    const row = buildRow();
    upsertJobRequest(row);
    setForm(row);
    setRefreshKey((x) => x + 1);
    if (isNew) {
      // New job now has a permanent id — move to its detail URL.
      router.replace(`${basePath}/${encodeURIComponent(row.id)}`);
    } else {
      setMsg("Saved.");
    }
  }

  function sendToGoogleCalendar() {
    openGoogleCal(form);
    setMsg("Opened Google Calendar template — click Save in Google to add the event.");
  }

  async function saveAndCreateQuoteNew() {
    if (!validate()) return;
    const row = buildRow();
    upsertJobRequest(row);
    try {
      const draft = await createDraftFromJob(row.id);
      window.location.href = `/quotes/${encodeURIComponent(draft.id)}/edit`;
    } catch (err: any) {
      setMsg(`Failed to create draft: ${err.message || err}`);
    }
  }

  function openGoogleCal(row: JobRequest) {
    window.open(googleCalendarLink({
      id: row.id, source: "job_request", client: row.client, eventName: row.eventName,
      venue: row.venue, venueAddress: row.venueAddress, city: row.city, state: row.state,
      cityState: row.cityState,
      startDate: row.requestDate, endDate: row.endDate || row.requestDate,
      startTime: row.startTime, endTime: row.endTime, notes: row.notes, status: row.status,
    }), "_blank", "noopener,noreferrer");
  }

  // Once a request leaves Lead status, lock everything except Status itself.
  // Payroll is locked regardless of status (read-only role).
  const isLocked = (!isNew && form.status !== "lead") || isPayroll;
  // Crew assignments stay editable through Booked. Only lock once closed out.
  const isCrewLocked = (!isNew && (form.status === "completed" || form.status === "lost")) || isPayroll;

  const effectiveEventAbbr = form.eventAbbr || defaultEventAbbr(form.eventName);

  const liveJobNo = useMemo(() => computeJobNo({
    startDate: form.requestDate,
    endDate: form.endDate,
    clientCode: form.clientId ? clientById.get(form.clientId)?.code : undefined,
    eventAbbr: effectiveEventAbbr,
  }), [form.requestDate, form.endDate, form.clientId, effectiveEventAbbr, clientById]);
  const statusLabel = JOB_REQUEST_STATUSES.find((s) => s.value === form.status)?.label ?? form.status;

  const backLink = (
    <Link href={basePath} className="secondary" style={{
      display: "inline-block", textDecoration: "none", padding: "6px 12px",
      border: "1px solid var(--border, #e5e7eb)", borderRadius: 6, fontSize: 13,
    }}>
      ← Back to jobs
    </Link>
  );

  // Payroll can view existing jobs but never create one (the list hides the
  // + New Job button; this covers direct /new links).
  if (isPayroll && isNew) {
    return (
      <div className="card" style={{ textAlign: "center", padding: "48px 24px" }}>
        <div style={{ fontSize: 16, marginBottom: 8 }}>Job access is view-only.</div>
        <div className="muted" style={{ marginBottom: 20, fontSize: 13 }}>
          The payroll role can review jobs but not create them.
        </div>
        {backLink}
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="card" style={{ textAlign: "center", padding: "48px 24px" }}>
        <div style={{ fontSize: 16, marginBottom: 8 }}>Job not found.</div>
        <div className="muted" style={{ marginBottom: 20, fontSize: 13 }}>
          This record may have been deleted or the link is out of date.
        </div>
        {backLink}
      </div>
    );
  }

  if (!seeded) return <div className="muted">Loading job…</div>;

  return (
    <div>
      <div className="action-row hide-print" style={{ marginBottom: 16, alignItems: "center" }}>
        {backLink}
      </div>

      <div className="card hide-print">
        <h2 className="section-title">{isNew ? "New Job" : "Edit Job"}</h2>

        <div style={{
          background: "var(--cream, #fbf6ee)",
          border: "1px solid var(--line, #d7c6aa)",
          borderRadius: 10,
          padding: "8px 14px",
          marginBottom: 12,
          display: "flex",
          alignItems: "baseline",
          gap: 12,
          flexWrap: "wrap",
        }}>
          <small style={{ opacity: 0.7 }}>Job #</small>
          <strong style={{ fontFamily: "monospace", fontSize: 15, letterSpacing: 0.4 }}>
            {liveJobNo ?? <span style={{ opacity: 0.5, fontWeight: 400, fontStyle: "italic" }}>
              will be assigned once Client + Event Name + Start Date are set
            </span>}
          </strong>
          {isLocked && liveJobNo && (
            <span className="badge" style={{ fontSize: 10, background: "#eef5ff", color: "#1e3a8a" }}>locked</span>
          )}
        </div>

        {deleteMsg && (
          <div style={{ background: "#fff3f3", border: "1px solid #e0a0a0", borderRadius: 8, padding: "8px 14px", marginBottom: 12, fontSize: 13, color: "#a00", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            {deleteMsg}
            <button className="secondary" style={{ fontSize: 12, padding: "2px 8px" }} onClick={() => setDeleteMsg(null)}>✕</button>
          </div>
        )}

        {confirmDeleteId && (
          <div style={{ background: "#fff8e1", border: "1px solid #e0c840", borderRadius: 8, padding: "10px 14px", marginBottom: 12, fontSize: 13, color: "#7a5f00" }}>
            Delete <strong>{form.eventName || "(no event name)"}</strong>? This cannot be undone.
            <div className="action-row" style={{ marginTop: 8 }}>
              <button style={{ background: "linear-gradient(180deg,#e05,#b00)", color: "#fff" }} onClick={confirmDelete}>Delete</button>
              <button className="secondary" onClick={() => setConfirmDeleteId(null)}>Cancel</button>
            </div>
          </div>
        )}

        {isPayroll ? (
          <div style={{
            background: "#eef5ff", border: "1px solid #b6cdf0", borderRadius: 8,
            padding: "8px 14px", marginBottom: 12, fontSize: 13, color: "#1e3a8a",
          }}>
            🔒 View only. Payroll can review job details but not change them.
          </div>
        ) : isLocked && (
          <div style={{
            background: "#eef5ff", border: "1px solid #b6cdf0", borderRadius: 8,
            padding: "8px 14px", marginBottom: 12, fontSize: 13, color: "#1e3a8a",
          }}>
            🔒 This job is <strong>{statusLabel}</strong>. Status and the <strong>Assigned Crew</strong> tab
            stay editable{form.status === "booked" ? " (booked jobs still need crew scheduling)" : ""};
            everything else is locked. Switch back to <strong>Lead</strong> to edit other fields.
          </div>
        )}

        <div className="grid4">
          <div>
            <small>Client *</small>
            <select value={form.clientId ?? ""} disabled={isLocked} onChange={(e) => selectClient(e.target.value)}>
              <option value="">— Select Client —</option>
              {activeClients.map((c) => <option key={c.id} value={c.id}>{c.code ? `[${c.code}] ${c.name}` : c.name}</option>)}
              {form.clientId && !activeClients.some((c) => c.id === form.clientId) && clientById.get(form.clientId) && (
                <option value={form.clientId}>{clientById.get(form.clientId)?.name} (inactive)</option>
              )}
            </select>
          </div>
          <div><small>Event Name</small><input disabled={isLocked} value={form.eventName} onChange={(e)=>setForm({ ...form, eventName:e.target.value })} /></div>
          <div>
            <small>Event Abbr <span style={{ opacity: 0.6 }}>(8 chars, used in Job #)</span></small>
            <input
              disabled={isLocked}
              value={form.eventAbbr ?? ""}
              onChange={(e) => setForm({ ...form, eventAbbr: sanitizeEventAbbr(e.target.value) })}
              placeholder={defaultEventAbbr(form.eventName) || "auto"}
              maxLength={8}
              style={{ fontFamily: "monospace", textTransform: "uppercase" }}
            />
          </div>
          <div><small>Venue</small><input disabled={isLocked} value={form.venue} onChange={(e)=>setForm({ ...form, venue:e.target.value })} /></div>
          <div><small>Street Address</small><input disabled={isLocked} value={form.venueAddress} onChange={(e)=>setForm({ ...form, venueAddress:e.target.value })} placeholder="e.g. 123 Main St" /></div>
          <div><small>Suite / Unit</small><input disabled={isLocked} value={form.venueAddress2 ?? ""} onChange={(e)=>setForm({ ...form, venueAddress2:e.target.value })} placeholder="optional" /></div>
          <div><small>City</small><input disabled={isLocked} value={form.city} onChange={(e)=>setForm({ ...form, city:e.target.value })} /></div>
          <div><small>State</small>
            <select disabled={isLocked} value={form.state} onChange={(e)=>setForm({ ...form, state:e.target.value })}>
              <option value="">— Select —</option>
              {US_STATES.map((s)=><option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div><small>Venue Zip</small><input disabled={isLocked} value={form.venueZip ?? ""} onChange={(e)=>setForm({ ...form, venueZip:e.target.value })} placeholder="00000" /></div>
          <div><small>Status</small>
            <select disabled={isPayroll} value={form.status} onChange={(e) => {
              const next = { ...form, status: e.target.value };
              setForm(next);
              if (form.id) {
                upsertJobRequest(normalized(next));
                setMsg(`Status saved as ${JOB_REQUEST_STATUSES.find((s) => s.value === e.target.value)?.label ?? e.target.value}.`);
                setRefreshKey((x) => x + 1);
              }
            }}>
              {JOB_REQUEST_STATUSES.map((s)=><option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </div>
          <div><small>Request Date</small><input type="date" disabled={isLocked} value={form.receivedDate} onChange={(e)=>setForm({ ...form, receivedDate:e.target.value })} /></div>
          <div><small>Event Start Date</small><input type="date" disabled={isLocked} value={form.requestDate} onChange={(e)=>setForm({ ...form, requestDate:e.target.value })} /></div>
          <div>
            <small>Event End Date</small>
            <input type="date" disabled={isLocked} min={form.requestDate || undefined} value={form.endDate || ""} onChange={(e)=>setForm({ ...form, endDate:e.target.value })} />
            {form.endDate && form.requestDate && form.endDate < form.requestDate && (
              <div style={{ fontSize: 11, color: "#c2410c", marginTop: 2 }}>
                ⚠ End date is before start date.
              </div>
            )}
          </div>
          <div><small>Start Time</small>
            <select disabled={isLocked} value={form.startTime} onChange={(e)=>setForm({ ...form, startTime:e.target.value })}>
              {TIMES.map((t)=><option key={t} value={t}>{t || "— Select —"}</option>)}
            </select>
          </div>
          <div><small>End Time</small>
            <select disabled={isLocked} value={form.endTime} onChange={(e)=>setForm({ ...form, endTime:e.target.value })}>
              {TIMES.map((t)=><option key={t} value={t}>{t || "— Select —"}</option>)}
            </select>
          </div>
          <div><small>Expected Hours / Day</small><input type="number" disabled={isLocked} value={form.expectedHours || 10} onChange={(e)=>setForm({ ...form, expectedHours:Number(e.target.value || 0) })} /></div>
          <div><small>Show in app calendar</small>
            <select disabled={isLocked} value={String(form.addToCalendar)} onChange={(e)=>setForm({ ...form, addToCalendar:e.target.value === "true" })}>
              <option value="true">Yes</option><option value="false">No</option>
            </select>
          </div>
        </div>

        {mapAddress(form) && (
          <div style={{ marginTop: 12 }}>
            <small>Venue Map</small>
            <a
              href={`https://maps.google.com/?q=${encodeURIComponent(mapAddress(form))}`}
              target="_blank"
              rel="noreferrer"
              title="Open in Maps"
              style={{ display: "block", marginTop: 4, borderRadius: 8, overflow: "hidden", border: "1px solid var(--border, #e5e7eb)" }}
            >
              <iframe
                src={`https://maps.google.com/maps?q=${encodeURIComponent(mapAddress(form))}&output=embed`}
                width="100%"
                height="220"
                style={{ border: 0, display: "block", pointerEvents: "none" }}
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
              />
            </a>
            <div style={{ fontSize: 11, color: "#888", marginTop: 4 }}>Tap to open in your maps app</div>
          </div>
        )}

        <div style={{ marginTop: 12 }}><small>Notes</small><textarea disabled={isLocked} value={form.notes} onChange={(e)=>setForm({ ...form, notes:e.target.value })} /></div>

        {!isCrewLeader && (
        <div style={{ marginTop: 12, fontSize: 12, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <small style={{ opacity: 0.7 }}>Rate card</small>
          <select
            disabled={isLocked}
            value={form.rateCardProfileId ?? ""}
            onChange={(e) => setForm({ ...form, rateCardProfileId: e.target.value || undefined })}
            title="Pin a rate card to this job (overrides auto-resolution by date). Quote create uses this."
            style={{ fontSize: 12, maxWidth: 360 }}
          >
            <option value="">
              Auto{applicableRateCardLabel ? ` — ${applicableRateCardLabel}` : ""}
            </option>
            {allRateCardProfiles
              .filter((p) =>
                (form.clientId && p.client_name && clientById.get(form.clientId)?.name === p.client_name)
                || p.id === "ratecard-master-default"
              )
              .map((p) => {
                const label = p.id === "ratecard-master-default"
                  ? p.name
                  : [p.client_name, p.name].filter(Boolean).join(" — ");
                return (
                  <option key={p.id} value={p.id}>
                    {label}{p.effective_date ? ` (eff ${p.effective_date})` : ""}
                  </option>
                );
              })}
          </select>
        </div>
        )}

        {editingId && shiftCount === 0 ? (
          <div style={{ marginTop: 12, padding: "8px 12px", background: "#fdf3d8", border: "1px solid #d8a800", borderRadius: 4, fontSize: 13 }}>
            <strong>⚠ No shifts defined on this job.</strong>
            <div className="muted" style={{ marginTop: 4, fontSize: 12 }}>
              Timekeeping won't show a shift picker, and payroll's daily rules
              (5-hour minimum, round-up) will group by position instead of by
              shift. That works for simple jobs, but multi-shift days
              (morning call + load-out, etc.) won't get separate 5-hour
              minimums. <strong>Set up shifts on the Shifts tab before
              timekeeping starts.</strong>
            </div>
          </div>
        ) : null}

        {headerDaysMismatch ? (
          <div style={{ marginTop: 12, padding: "8px 12px", background: "#fdf3d8", border: "1px solid #d8a800", borderRadius: 4, fontSize: 13 }}>
            <strong>⚠ Header dates don't match day rows:</strong>
            <ul style={{ margin: "6px 0 0 18px", padding: 0 }}>
              {headerDaysMismatch.map((m, i) => <li key={i}>{m}</li>)}
            </ul>
            <div className="muted" style={{ marginTop: 4, fontSize: 12 }}>
              Header date changes don't auto-add or remove day rows. Go to the Days tab to add or delete days manually (deleting a day cascades to its crew needs).
            </div>
          </div>
        ) : null}

        {possibleDuplicates.length > 0 ? (
          <div style={{ marginTop: 12, padding: "8px 12px", background: "#fdf3d8", border: "1px solid #d8a800", borderRadius: 4, fontSize: 13 }}>
            <strong>⚠ Possible duplicate:</strong> this client already has a job starting {form.requestDate}.
            <ul style={{ margin: "6px 0 0 18px", padding: 0 }}>
              {possibleDuplicates.map((d) => {
                const code = clientById.get(d.clientId)?.code ?? "";
                return (
                  <li key={d.id}>
                    {d.eventName || "(no event name)"} — {code} · {d.requestDate}
                    {d.endDate && d.endDate !== d.requestDate ? `–${d.endDate}` : ""}
                    {d.status ? ` · ${d.status}` : ""}
                    {d.jobNo ? <> · <code>{d.jobNo}</code></> : null}
                    {" "}
                    <Link
                      className="link"
                      style={{ marginLeft: 6, color: "#0366d6", textDecoration: "underline" }}
                      href={`${basePath}/${encodeURIComponent(d.id)}`}
                    >open</Link>
                  </li>
                );
              })}
            </ul>
            <div className="muted" style={{ marginTop: 4, fontSize: 12 }}>
              Legitimate cases (e.g. multiple stages at the same venue on the same day) can still save — you'll be asked to confirm.
            </div>
          </div>
        ) : null}

        <div className="action-row" style={{ marginTop: 12 }}>
          {!isPayroll && <button onClick={save}>Save</button>}
          {isNew && !isCrewLeader && (
            <button onClick={saveAndCreateQuoteNew}>Save + Create Quote</button>
          )}
          {editingId && !isCrewLeader && !isPayroll && (
            <>
              {openDraftId ? (
                <button onClick={() => { window.location.href = `/quotes/${encodeURIComponent(openDraftId)}/edit`; }}>
                  Continue Draft Quote
                </button>
              ) : null}
              {latestIssuedId ? (
                <button onClick={() => { window.location.href = `/quotes/${encodeURIComponent(latestIssuedId)}`; }}>
                  View Quote
                </button>
              ) : null}
              {!openDraftId && !latestIssuedId && !isLocked ? (
                <button onClick={saveAndCreateQuoteNew}>Create Quote</button>
              ) : null}
            </>
          )}
          {editingId && !isPayroll && (
            <button
              className="secondary"
              onClick={() => { window.location.href = timesheetHref; }}
              title="Open the timesheet for this job"
            >
              Timesheet
            </button>
          )}
          {editingId && (
            <button
              className="secondary"
              onClick={() => printWithTitle(["Job", form.jobNo || form.eventName, form.client])}
              title="Print a one-page summary of this job"
            >
              Print PDF
            </button>
          )}
          {editingId && (
            <button
              className="secondary"
              onClick={() => {
                // Reveal the sign-in sheet (and hide the summary sheet) for this
                // one print, then clean the body class up on afterprint.
                document.body.classList.add("printing-signin");
                const cleanup = () => {
                  document.body.classList.remove("printing-signin");
                  window.removeEventListener("afterprint", cleanup);
                };
                window.addEventListener("afterprint", cleanup);
                setTimeout(cleanup, 60_000);
                printWithTitle(["Sign-In Sheet", form.jobNo || form.eventName, form.client]);
              }}
              title="Print a crew sign-in sheet (planned times + blank time/signature lines) from the assigned crew"
            >
              Sign-In Sheet
            </button>
          )}
          {editingId && form.addToCalendar && (
            <button
              onClick={sendToGoogleCalendar}
              title="Open a Google Calendar template prefilled with this event"
              style={{
                display: "inline-flex", alignItems: "center", gap: 8,
                background: "#fff", color: "#3c4043",
                border: "1px solid #dadce0", borderRadius: 6,
                padding: "6px 14px", fontWeight: 500, fontSize: 13,
                boxShadow: "0 1px 2px rgba(60,64,67,0.1)",
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
                <rect x="3" y="5" width="18" height="16" rx="2" fill="#fff" stroke="#dadce0" strokeWidth="1.2" />
                <rect x="3" y="5" width="18" height="4" rx="2" fill="#4285f4" />
                <rect x="6"  y="11" width="3" height="3" fill="#ea4335" />
                <rect x="10.5" y="11" width="3" height="3" fill="#fbbc04" />
                <rect x="15" y="11" width="3" height="3" fill="#34a853" />
                <rect x="6"  y="15.5" width="3" height="3" fill="#34a853" />
                <rect x="10.5" y="15.5" width="3" height="3" fill="#4285f4" />
                <rect x="15" y="15.5" width="3" height="3" fill="#ea4335" />
              </svg>
              Add to Google Calendar
            </button>
          )}
          <button className="secondary" onClick={() => router.push(basePath)}>{isPayroll ? "Back" : editingId ? "Cancel" : "Clear"}</button>
          {editingId && !isCrewLeader && !isPayroll && (
            <button className="secondary" style={{ color: "#c00", marginLeft: "auto" }} onClick={requestDelete}>
              Delete
            </button>
          )}
        </div>
        {msg ? <div className="badge" style={{ marginTop: 12 }}>{msg}</div> : null}

        <div style={{ marginTop: 20, borderTop: "1px solid var(--border, #e5e7eb)", paddingTop: 12 }}>
          <div role="tablist" style={{ display: "flex", gap: 0, borderBottom: "1px solid var(--border, #e5e7eb)", marginBottom: 12 }}>
            {([
              { id: "daily" as const,       label: "Daily Requirements" },
              { id: "crew" as const,        label: "Assigned Crew" },
              { id: "shifts" as const,      label: "Shifts" },
              { id: "attachments" as const, label: "Attachments" },
              { id: "health" as const,      label: "Health Check" },
            ]).map((t) => {
              const active = sectionTab === t.id;
              const showBadge = t.id === "health" && healthCounts && healthCounts.total > 0;
              const badgeColor = healthCounts && healthCounts.blocker > 0 ? "#dc2626"
                : healthCounts && healthCounts.warning > 0 ? "#d97706"
                : "#2563eb";
              return (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setSectionTab(t.id)}
                  style={{
                    background: "transparent",
                    border: "none",
                    borderBottom: active ? "2px solid var(--accent, #2563eb)" : "2px solid transparent",
                    color: active ? "var(--accent, #2563eb)" : "inherit",
                    padding: "8px 14px",
                    fontSize: 13,
                    fontWeight: active ? 600 : 500,
                    cursor: "pointer",
                    marginBottom: -1,
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                  }}
                >
                  {t.label}
                  {showBadge ? (
                    <span style={{
                      background: badgeColor,
                      color: "#fff",
                      borderRadius: 10,
                      padding: "1px 7px",
                      fontSize: 11,
                      fontWeight: 600,
                      lineHeight: 1.4,
                    }}>{healthCounts!.total}</span>
                  ) : null}
                </button>
              );
            })}
          </div>

          {sectionTab === "daily" && (
            editingId
              ? <JobRequestDaysSection jobRequestId={editingId} disabled={isLocked} hideHeader jobStartDate={form.requestDate} />
              : <div className="muted" style={{ fontSize: 13, padding: "8px 0" }}>
                  Save the job first to start adding days and crew requirements.
                </div>
          )}

          {sectionTab === "crew" && (
            editingId
              ? <JobRequestCrewSection jobRequestId={editingId} disabled={isCrewLocked} hideHeader />
              : <div className="muted" style={{ fontSize: 13, padding: "8px 0" }}>
                  Save the job first to start assigning crew.
                </div>
          )}

          {sectionTab === "shifts" && (
            editingId
              ? <JobRequestShiftsSection jobRequestId={editingId} hideHeader readOnly={isPayroll} />
              : <div className="muted" style={{ fontSize: 13, padding: "8px 0" }}>
                  Save the job first to start adding shifts.
                </div>
          )}

          {sectionTab === "attachments" && (
            editingId
              ? <JobRequestAttachmentsSection jobRequestId={editingId} hideHeader readOnly={isPayroll} />
              : <div className="muted" style={{ fontSize: 13, padding: "8px 0" }}>
                  Save the job first to start adding attachments.
                </div>
          )}

          {sectionTab === "health" && (
            editingId
              ? <JobHealthSection jobRequest={form} refreshKey={refreshKey} />
              : <div className="muted" style={{ fontSize: 13, padding: "8px 0" }}>
                  Save the job first to run the health check.
                </div>
          )}
        </div>
      </div>

      {/* Print-only summary; rendered hidden on screen, fully laid out in print. */}
      {editingId && <JobPrintSheet form={form} />}
      {editingId && <CrewSignInSheet form={form} />}
    </div>
  );
}
