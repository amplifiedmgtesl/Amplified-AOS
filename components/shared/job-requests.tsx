"use client";

import { useEffect, useMemo, useState } from "react";
import { upsertJobRequest, deleteJobRequest, setActiveQuote } from "@/lib/store/app-store";
import { createDraftFromJob, pickRateCardForJob, loadJobQuoteState } from "@/lib/store/quotes";
import { googleCalendarLink } from "@/lib/store/calendar";
import { loadJobRequests } from "@/lib/store/app-store";
import { timeOptions } from "@/lib/store/timekeeping";
import { supabase } from "@/lib/supabase/client";
import { US_STATES, JOB_REQUEST_STATUSES } from "@/lib/constants";
import { JobRequestAttachmentsSection } from "./job-request-attachments-section";
import { JobRequestDaysSection } from "./job-request-days-section";
import { loadJobRequestDays } from "@/lib/storage/job-request-days";
import { JobRequestCrewSection } from "./job-request-crew-section";
import { JobRequestShiftsSection } from "./job-request-shifts-section";
import { JobHealthSection, useJobHealthCount } from "./job-health-section";
import { JobPrintSheet } from "./job-print-sheet";
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

type StatusFilter = "active" | "all" | "lead" | "quoted" | "booked" | "completed" | "lost";
const ACTIVE_STATUSES = new Set(["lead", "quoted", "booked"]);

// How many days past the event end before a booked row gets a "ready to mark
// completed" badge. Just a visual nudge — nothing happens automatically.
const COMPLETED_NUDGE_DAYS = 7;

function daysSince(iso?: string): number | null {
  if (!iso) return null;
  const t = Date.parse(iso + "T00:00:00");
  if (Number.isNaN(t)) return null;
  return Math.floor((Date.now() - t) / 86400000);
}

type Mode = "none" | "new" | "edit";
type SectionTab = "daily" | "crew" | "shifts" | "attachments" | "health";

export default function JobRequests() {
  const [refreshKey, setRefreshKey] = useState(0);
  const rows = useMemo(() => loadJobRequests(), [refreshKey]);
  const [mode, setMode] = useState<Mode>("none");
  const [form, setForm] = useState<JobRequest>({ ...BLANK });

  // Possible-duplicate detection: same client + same start date as an
  // existing job. Soft warning only — legitimate cases exist (e.g. a venue
  // running two stages on the same day gets two job_requests by design).
  // Excludes the row currently being edited.
  const possibleDuplicates = useMemo(() => {
    if (!form.clientId || !form.requestDate) return [];
    const editingId = form.id || "";
    return rows.filter((r) =>
      r.id !== editingId &&
      r.clientId === form.clientId &&
      r.requestDate === form.requestDate,
    );
  }, [rows, form.clientId, form.requestDate, form.id]);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Track the date extent of this job's day rows (min/max event_date) so
  // we can warn when the header date range no longer covers them. Loaded
  // lazily when editing — new jobs have no day rows yet.
  const [dayExtent, setDayExtent] = useState<{ min: string; max: string } | null>(null);
  useEffect(() => {
    if (!editingId) { setDayExtent(null); return; }
    let cancelled = false;
    (async () => {
      try {
        const days = await loadJobRequestDays(editingId);
        if (cancelled) return;
        const dates = days.map((d) => d.eventDate).filter(Boolean).sort();
        setDayExtent(dates.length > 0
          ? { min: dates[0], max: dates[dates.length - 1] }
          : null);
      } catch (err) {
        console.error("[job-requests] loadJobRequestDays for header warning:", err);
      }
    })();
    return () => { cancelled = true; };
  }, [editingId, refreshKey]);

  // Shift count for the editing job. Used by the "no shifts defined" warning
  // banner. When zero, timekeeping has no shift picker and payroll's daily
  // rules fall back to (position) grouping instead of (shift, position) —
  // which works but is less precise on multi-shift days.
  const [shiftCount, setShiftCount] = useState<number | null>(null);
  useEffect(() => {
    if (!editingId) { setShiftCount(null); return; }
    let cancelled = false;
    (async () => {
      try {
        const { supabase } = await import("@/lib/supabase/client");
        const { count, error } = await supabase
          .from("job_request_shifts")
          .select("id", { count: "exact", head: true })
          .eq("job_request_id", editingId)
          .eq("is_active", true);
        if (cancelled) return;
        if (error) { console.error("[job-requests] shift count:", error); return; }
        setShiftCount(count ?? 0);
      } catch (err) {
        console.error("[job-requests] shift count load:", err);
      }
    })();
    return () => { cancelled = true; };
  }, [editingId, refreshKey]);

  // Header-vs-days mismatch: form's date range no longer covers the actual
  // day rows. Soft warning — header doesn't auto-add/remove days. Operator
  // fixes by going to the Days tab and removing/adding day rows manually.
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
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleteMsg, setDeleteMsg] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("active");
  const [sectionTab, setSectionTab] = useState<SectionTab>("daily");
  // Drives the count badge on the Health Check tab. Returns null until the
  // checks finish their first run; falsy until editingId is set.
  const healthCounts = useJobHealthCount(editingId ? form : null, refreshKey);
  const role = useUserRole();
  const isCrewLeader = role === "crew_leader";
  const timesheetHref = isCrewLeader ? "/lead/timekeeping" : "/timekeeping";

  // Quote state for the currently-edited job. Drives the Create/Continue/View
  // button logic — see the action row below.
  const [openDraftId, setOpenDraftId] = useState<string | null>(null);
  const [latestIssuedId, setLatestIssuedId] = useState<string | null>(null);

  // Display + override the applicable rate card right on the job header so the
  // admin sees what rates a quote off this job will use, and can pin a
  // specific card if the auto-resolved one isn't right.
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
    // Shared definition of the job's quote state — also used by the crew-roster
    // export's "active quote" source. See lib/store/quotes.ts.
    loadJobQuoteState(editingId)
      .then(({ openDraftId, latestIssuedId }) => {
        if (cancelled) return;
        setOpenDraftId(openDraftId);
        setLatestIssuedId(latestIssuedId);
      })
      .catch((error) => console.error("[job-requests] quote state load failed:", error));
    return () => { cancelled = true; };
  }, [editingId, refreshKey]);

  // Resolve the applicable rate card for the form's current client + start
  // date. Re-runs as the user changes either field so the displayed label
  // tracks live.
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
        console.error("[job-requests] rate card lookup failed:", err);
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

  // Deep-link:
  //   /job-requests?id=<jobreq-id>            → auto-open that record
  //   /job-requests?new=1&clientId=<client>   → blank form prefilled with that client
  // Lets the Client Maintenance "Jobs" tab (and other places) link directly
  // to a job, or jump into a new-job draft already scoped to the client.
  // Runs once after both rows AND clients are loaded, then strips the params.
  const [deepLinkHandled, setDeepLinkHandled] = useState(false);
  useEffect(() => {
    if (deepLinkHandled || typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const wantNew = params.get("new") === "1";
    const wantClientId = params.get("clientId");
    const wantId = params.get("id");

    // New-job path: needs clients loaded so we can resolve the client name.
    if (wantNew) {
      if (clients.length === 0) return; // wait for clients to load
      const c = wantClientId ? clientById.get(wantClientId) : undefined;
      setMode("new");
      setEditingId(null);
      setForm({
        ...BLANK,
        clientId: c?.id ?? "",
        client: c?.name ?? "",
      });
      setMsg("");
      window.history.replaceState({}, "", window.location.pathname);
      setDeepLinkHandled(true);
      return;
    }

    if (!wantId) { setDeepLinkHandled(true); return; }
    const target = rows.find((r) => r.id === wantId);
    if (target) {
      setMode("edit");
      setEditingId(target.id);
      setForm({ ...target });
      setMsg("");
      // Optional tab anchor — banners from quote/invoice/timekeeping
      // link straight into ?tab=health to land on the Health Check tab.
      const wantTab = params.get("tab");
      if (wantTab === "daily" || wantTab === "crew" || wantTab === "shifts"
        || wantTab === "attachments" || wantTab === "health") {
        setSectionTab(wantTab);
      }
      // Clean the URL so a refresh / future save doesn't bounce back here.
      window.history.replaceState({}, "", window.location.pathname);
      setDeepLinkHandled(true);
    } else if (rows.length > 0) {
      // Rows have loaded but the requested id isn't there — give up rather
      // than waiting forever for a row that doesn't exist.
      window.history.replaceState({}, "", window.location.pathname);
      setDeepLinkHandled(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows.length, clients.length, deepLinkHandled]);

  const clientById = useMemo(() => {
    const map = new Map<string, Client>();
    for (const c of clients) map.set(c.id, c);
    return map;
  }, [clients]);

  const activeClients = useMemo(() => clients.filter((c) => c.isActive), [clients]);

  function selectClient(clientId: string) {
    const c = clientById.get(clientId);
    setForm((f) => ({ ...f, clientId, client: c?.name ?? "" }));
  }

  function mapAddress(r: JobRequest): string {
    return [r.venueAddress, r.venueAddress2, r.city, r.state, r.venueZip].filter(Boolean).join(", ");
  }

  function normalized(next: JobRequest): JobRequest {
    return {
      ...next,
      cityState: [next.city, next.state].filter(Boolean).join(", "),
    };
  }

  function selectRow(r: JobRequest) {
    setMode("edit");
    setEditingId(r.id);
    setForm({ ...r });
    setMsg("");
    setDeleteMsg(null);
    setConfirmDeleteId(null);
  }

  function startNew() {
    setMode("new");
    setEditingId(null);
    setForm({ ...BLANK });
    setMsg("");
    setDeleteMsg(null);
    setConfirmDeleteId(null);
  }

  function clearForm() {
    setMode("none");
    setEditingId(null);
    setForm({ ...BLANK });
    setMsg("");
    setDeleteMsg(null);
    setConfirmDeleteId(null);
  }

  function cancelEdit() {
    clearForm();
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
    setDeleteMsg(null);
    clearForm();
    setRefreshKey((x) => x + 1);
  }

  /** Build a confirm-dialog message listing possible duplicates, returns
   *  true when the user wants to proceed anyway. Returns true immediately
   *  when there are no candidates so non-duplicate saves never prompt. */
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

  function save() {
    if (!form.clientId) { setMsg("Please select a client before saving."); return; }
    if (!form.eventName.trim()) { setMsg("Please enter an event name before saving."); return; }
    if (!form.requestDate) { setMsg("Please pick an event start date before saving."); return; }
    if (form.endDate && form.endDate < form.requestDate) { setMsg("End date can't be before the start date."); return; }
    if (!confirmIfDuplicates()) return;
    const row = normalized({
      ...form,
      id: form.id || `jobreq-${Date.now()}`,
      eventAbbr: effectiveEventAbbr || undefined,
      jobNo: liveJobNo || undefined,
    });
    upsertJobRequest(row);
    setMsg("Saved.");
    setMode("edit");
    setEditingId(row.id);
    setForm(row);
    setRefreshKey((x) => x + 1);
  }

  function sendToGoogleCalendar() {
    openGoogleCal(form);
    setMsg("Opened Google Calendar template — click Save in Google to add the event.");
  }

  /** Save the job request, then route through lib/store/quotes.ts to create
   *  a draft row tied to job_request_id and open the new editor. */
  async function saveAndCreateQuoteNew() {
    if (!form.clientId) { setMsg("Please select a client before saving."); return; }
    if (!form.eventName.trim()) { setMsg("Please enter an event name before saving."); return; }
    if (!form.requestDate) { setMsg("Please pick an event start date before saving."); return; }
    if (form.endDate && form.endDate < form.requestDate) { setMsg("End date can't be before the start date."); return; }
    if (!confirmIfDuplicates()) return;
    const row = normalized({
      ...form,
      id: form.id || `jobreq-${Date.now()}`,
      eventAbbr: effectiveEventAbbr || undefined,
      jobNo: liveJobNo || undefined,
    });
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

  // ── Filtering / sorting for left list ──
  const visibleRows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return rows
      .filter((r) => {
        if (statusFilter === "active") return ACTIVE_STATUSES.has(r.status);
        if (statusFilter === "all") return true;
        return r.status === statusFilter;
      })
      .filter((r) => {
        if (!term) return true;
        const code = clientById.get(r.clientId)?.code ?? "";
        return (
          r.eventName.toLowerCase().includes(term) ||
          (r.client ?? "").toLowerCase().includes(term) ||
          code.toLowerCase().includes(term) ||
          (r.venue ?? "").toLowerCase().includes(term)
        );
      })
      .sort((a, b) => {
        // Most recent / upcoming first by event start date.
        const da = a.requestDate || "";
        const db = b.requestDate || "";
        return db.localeCompare(da);
      });
  }, [rows, search, statusFilter, clientById]);

  // Once a request leaves Lead status, lock everything except Status itself.
  // Editing a quoted/booked/lost request would silently mutate downstream
  // artifacts (the quote built off it, the booked job's terms, etc.).
  const isLocked = mode === "edit" && form.status !== "lead";
  // Crew assignments stay editable through Booked — that's when scheduling
  // actually happens. Only lock once the job is closed out (Completed/Lost).
  const isCrewLocked = mode === "edit" && (form.status === "completed" || form.status === "lost");

  // The effective event abbreviation: user override wins; otherwise auto-
  // derive from the event_name (uppercase, alphanumeric only, ≤8 chars).
  const effectiveEventAbbr = form.eventAbbr || defaultEventAbbr(form.eventName);

  // Live-computed job_no based on current form state. Displayed at the top of
  // the editor as a readonly label and persisted on save. Recomputes
  // automatically as any source field changes.
  const liveJobNo = useMemo(() => computeJobNo({
    startDate: form.requestDate,
    endDate: form.endDate,
    clientCode: form.clientId ? clientById.get(form.clientId)?.code : undefined,
    eventAbbr: effectiveEventAbbr,
  }), [form.requestDate, form.endDate, form.clientId, effectiveEventAbbr, clientById]);
  const statusLabel = JOB_REQUEST_STATUSES.find((s) => s.value === form.status)?.label ?? form.status;

  return (
    <div style={{ display: "flex", gap: 20, alignItems: "flex-start", height: "100%" }}>
      {/* ── Left: list ── */}
      <div className="hide-print" style={{ width: 300, flexShrink: 0 }}>
        <div style={{ display: "flex", gap: 8, marginBottom: 8, alignItems: "center" }}>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search event / client / venue…"
            style={{ flex: 1 }}
          />
          <button onClick={startNew} title="New job" style={{ whiteSpace: "nowrap" }}>+ New</button>
        </div>
        <div style={{ marginBottom: 12 }}>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            style={{ width: "100%", fontSize: 12 }}
          >
            <option value="active">Active (Lead + Quoted + Booked)</option>
            <option value="all">All statuses</option>
            <option value="lead">Lead only</option>
            <option value="quoted">Quoted only</option>
            <option value="booked">Booked only</option>
            <option value="completed">Completed only</option>
            <option value="lost">Lost only</option>
          </select>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 2, maxHeight: "calc(100vh - 220px)", overflowY: "auto" }}>
          {visibleRows.length === 0 ? (
            <div className="muted" style={{ fontSize: 13, padding: "8px 4px" }}>No matching jobs.</div>
          ) : (
            visibleRows.map((r) => {
              const c = clientById.get(r.clientId);
              const code = c?.code;
              const isSelected = editingId === r.id;
              const eventEnd = r.endDate || r.requestDate;
              const daysPast = r.status === "booked" ? daysSince(eventEnd) : null;
              const overdue = daysPast !== null && daysPast >= COMPLETED_NUDGE_DAYS;
              return (
                <button
                  key={r.id}
                  onClick={() => selectRow(r)}
                  style={{
                    textAlign: "left",
                    background: isSelected ? "var(--accent, #2563eb)" : "transparent",
                    color: isSelected ? "#fff" : "inherit",
                    border: "1px solid " + (isSelected ? "var(--accent, #2563eb)" : "var(--border, #e5e7eb)"),
                    borderRadius: 6, padding: "8px 12px", cursor: "pointer", width: "100%",
                    fontSize: 13,
                  }}
                >
                  <div style={{
                    fontFamily: "monospace", fontSize: 12, fontWeight: 700,
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    letterSpacing: 0.3,
                  }} title={r.jobNo || ""}>
                    {r.jobNo || <span style={{ fontStyle: "italic", opacity: 0.6, fontWeight: 400 }}>(no job #)</span>}
                  </div>
                  <div style={{
                    display: "flex", gap: 6, alignItems: "baseline", marginTop: 3,
                    fontSize: 12,
                  }}>
                    <span style={{ opacity: 0.85 }}>{code ? `[${code}]` : (c?.name ?? r.client ?? "?").slice(0, 18)}</span>
                    <span style={{ opacity: 0.6 }}>·</span>
                    <span style={{ opacity: 0.85 }}>{r.requestDate || "no date"}</span>
                    <span style={{
                      marginLeft: "auto", fontSize: 10, textTransform: "uppercase", opacity: 0.7,
                      fontWeight: 500, letterSpacing: 0.4,
                    }}>{r.status}</span>
                  </div>
                  <div style={{
                    fontSize: 11, opacity: 0.75, marginTop: 2,
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }} title={r.eventName}>
                    {r.eventName || <span style={{ fontStyle: "italic", opacity: 0.5 }}>(no event name)</span>}
                  </div>
                  {overdue && (
                    <div style={{
                      marginTop: 4, fontSize: 11,
                      color: isSelected ? "#fff" : "#a86400",
                      fontStyle: "italic",
                    }} title="Mark this Completed when the event is wrapped up">
                      ⚠ Event ended {daysPast} day{daysPast === 1 ? "" : "s"} ago — mark Completed?
                    </div>
                  )}
                </button>
              );
            })
          )}
        </div>

        <div style={{ marginTop: 12, borderTop: "1px solid var(--border, #e5e7eb)", paddingTop: 8 }}>
          <div className="muted" style={{ fontSize: 11 }}>
            {visibleRows.length} of {rows.length} job{rows.length !== 1 ? "s" : ""}
          </div>
        </div>
      </div>

      {/* ── Right: form or empty state ── */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {mode === "none" ? (
          <div className="card" style={{ textAlign: "center", padding: "60px 24px", color: "#888" }}>
            <div style={{ fontSize: 16, marginBottom: 8 }}>No job selected.</div>
            <div style={{ fontSize: 13, marginBottom: 20 }}>
              Pick one from the list on the left to view or edit it, or start a new one.
            </div>
            <button onClick={startNew}>+ New Job</button>
          </div>
        ) : (
        <div className="card hide-print">
          <h2 className="section-title">{mode === "edit" ? "Edit Job" : "New Job"}</h2>

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

          {isLocked && (
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
                {/* If editing a record whose client has been deactivated, keep it visible. */}
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
              <select value={form.status} onChange={(e) => {
                const next = { ...form, status: e.target.value };
                setForm(next);
                // Status auto-saves on change for already-saved records.
                // New drafts (no id yet) still go through the Save button.
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

          {/* Rate card pick (optional override). Filtered to cards for the
              selected client plus the master default. Quotes off this job
              honor the pin; if left as Auto, pickRateCardForJob runs.
              Hidden from crew leaders — billing config is admin-only. */}
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
                  // Only show this client's cards + the master default.
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
            <div style={{
              marginTop: 12,
              padding: "8px 12px",
              background: "#fdf3d8",
              border: "1px solid #d8a800",
              borderRadius: 4,
              fontSize: 13,
            }}>
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
            <div style={{
              marginTop: 12,
              padding: "8px 12px",
              background: "#fdf3d8",
              border: "1px solid #d8a800",
              borderRadius: 4,
              fontSize: 13,
            }}>
              <strong>⚠ Header dates don't match day rows:</strong>
              <ul style={{ margin: "6px 0 0 18px", padding: 0 }}>
                {headerDaysMismatch.map((msg, i) => <li key={i}>{msg}</li>)}
              </ul>
              <div className="muted" style={{ marginTop: 4, fontSize: 12 }}>
                Header date changes don't auto-add or remove day rows. Go to the Days tab to add or delete days manually (deleting a day cascades to its crew needs).
              </div>
            </div>
          ) : null}

          {possibleDuplicates.length > 0 ? (
            <div style={{
              marginTop: 12,
              padding: "8px 12px",
              background: "#fdf3d8",
              border: "1px solid #d8a800",
              borderRadius: 4,
              fontSize: 13,
            }}>
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
                      <button
                        type="button"
                        className="link"
                        style={{ marginLeft: 6, padding: 0, background: "none", border: "none", color: "#0366d6", cursor: "pointer", textDecoration: "underline" }}
                        onClick={() => { setEditingId(d.id); setForm(d); setMode("edit"); }}
                      >open</button>
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
            <button onClick={save}>Save</button>
            {/* New-quote entry point. The button label/action adapts to existing
                quote state for this job:
                  - Open draft exists  → "Continue Draft Quote" (route to editor)
                  - Issued quote exists → "View Quote" (route to detail; user
                                          revises from there if needed)
                  - Otherwise           → "Create Quote" (fresh draft) */}
            {!editingId && !isCrewLeader && (
              <button onClick={saveAndCreateQuoteNew}>Save + Create Quote</button>
            )}
            {editingId && !isCrewLeader && (
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
            {editingId && (
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
            <button className="secondary" onClick={cancelEdit}>{editingId ? "Cancel" : "Clear"}</button>
            {editingId && !isCrewLeader && (
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
                ? <JobRequestShiftsSection jobRequestId={editingId} hideHeader />
                : <div className="muted" style={{ fontSize: 13, padding: "8px 0" }}>
                    Save the job first to start adding shifts.
                  </div>
            )}

            {sectionTab === "attachments" && (
              editingId
                ? <JobRequestAttachmentsSection jobRequestId={editingId} hideHeader />
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
        )}

        {/* Print-only summary; rendered hidden on screen, fully laid out in print. */}
        {editingId && <JobPrintSheet form={form} />}
      </div>
    </div>
  );
}
