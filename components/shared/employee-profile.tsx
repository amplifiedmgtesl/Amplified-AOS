"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  deleteEmployee,
  loadDeletedEmployeeKeys,
  loadEmployees,
  loadJobSheets,
  loadTimesheets,
  upsertEmployee,
} from "@/lib/store/app-store";
import { useUserRole } from "@/lib/auth/use-user-role";
import { uploadProfilePicture, deleteEmployeeAsset } from "@/lib/storage/employee-assets";
import {
  loadDocuments as loadEmployeeDocs,
  uploadDocument as uploadEmployeeDoc,
  removeDocument as removeEmployeeDoc,
  type EmployeeDocument as EmployeeDocRow,
} from "@/lib/storage/employee-documents";
import { US_STATES } from "@/lib/constants";
import type { EmployeeRecord } from "@/lib/store/types";
import { useRouter } from "next/navigation";

function activeEmployees() {
  const deleted = new Set(loadDeletedEmployeeKeys());
  return loadEmployees().filter((e) => !deleted.has(e.employeeKey));
}

// Common employment-type choices + any distinct values already saved in the
// directory. Lets the profile dropdown pick from a clean list while still
// honoring any legacy values that happen to exist.
const COMMON_EMPLOYMENT_TYPES = ["Employee", "Contractor", "W2", "1099", "Full-Time", "Part-Time", "Seasonal"];

/**
 * Standalone employee profile — the full-page detail view for one employee,
 * reached from the directory list. Mirrors the quotes/invoices flow where the
 * list and the record live on separate routes.
 *
 * `basePath` is the route tree this profile lives under so the back link and
 * post-delete redirect stay inside the admin app (/employee-directory) or the
 * crew-leader app (/lead/employees).
 */
export default function EmployeeProfile({
  employeeKey,
  basePath = "/employee-directory",
  hideBill: hideBillProp = false,
}: {
  employeeKey: string;
  basePath?: string;
  hideBill?: boolean;
}) {
  const router = useRouter();
  // Belt + suspenders: even if this somehow renders inside an admin shell,
  // force-hide pay if the viewer is a crew_leader or coordinator.
  const viewerRole = useUserRole();
  const hideBill = hideBillProp || viewerRole === "crew_leader" || viewerRole === "coordinator";

  const [refreshKey, setRefreshKey] = useState(0);
  const [historyModal, setHistoryModal] = useState<"jobs" | "timesheets" | null>(null);
  const [employeeDocs, setEmployeeDocs] = useState<EmployeeDocRow[]>([]);

  const employees = useMemo(() => activeEmployees(), [refreshKey]);
  const activeEmployee = employees.find((e) => e.employeeKey === employeeKey) || null;

  const types = useMemo(
    () => Array.from(new Set(employees.map((e) => e.employmentType || "").filter(Boolean))).sort(),
    [employees],
  );
  const employmentTypeOptions = useMemo(
    () => Array.from(new Set([...COMMON_EMPLOYMENT_TYPES, ...types])).sort(),
    [types],
  );

  // Load this employee's documents when the selection changes.
  useEffect(() => {
    if (!activeEmployee) { setEmployeeDocs([]); return; }
    let cancelled = false;
    loadEmployeeDocs(activeEmployee.employeeKey)
      .then((docs) => { if (!cancelled) setEmployeeDocs(docs); })
      .catch((err) => { console.error("[employee-profile] doc load failed:", err); if (!cancelled) setEmployeeDocs([]); });
    return () => { cancelled = true; };
  }, [activeEmployee?.employeeKey, refreshKey]);

  function updateActiveField<K extends keyof EmployeeRecord>(key: K, value: EmployeeRecord[K]) {
    if (!activeEmployee) return;
    const updated = { ...activeEmployee, [key]: value, source: "local" as const };
    // Keep fullName in sync when first/last change
    if (key === "firstName" || key === "lastName") {
      const fn = key === "firstName" ? (value as string) : activeEmployee.firstName;
      const ln = key === "lastName" ? (value as string) : activeEmployee.lastName;
      if (!activeEmployee.fullName || activeEmployee.fullName === `${activeEmployee.firstName} ${activeEmployee.lastName}`.trim()) {
        updated.fullName = `${fn} ${ln}`.trim();
      }
    }
    upsertEmployee(updated);
    setRefreshKey((x) => x + 1);
  }

  async function updateActivePicture(files: FileList | null) {
    if (!activeEmployee || !files?.[0]) return;
    try {
      const publicUrl = await uploadProfilePicture(activeEmployee.employeeKey, files[0]);
      upsertEmployee({ ...activeEmployee, profilePicture: publicUrl, source: "local" });
      setRefreshKey((x) => x + 1);
    } catch (err) {
      console.error("[employee-profile] profile picture upload failed:", err);
      alert("Failed to upload profile picture. Check console for details.");
    }
  }

  async function updateActiveDocuments(files: FileList | null) {
    if (!activeEmployee || !files?.length) return;
    try {
      const added: EmployeeDocRow[] = [];
      for (const file of Array.from(files)) {
        added.push(await uploadEmployeeDoc(activeEmployee.employeeKey, file));
      }
      setEmployeeDocs((cur) => [...added, ...cur]);
    } catch (err) {
      console.error("[employee-profile] document upload failed:", err);
      alert("Failed to upload one or more documents. Check console for details.");
    }
  }

  function saveActiveNotes(notes: string) {
    if (!activeEmployee) return;
    upsertEmployee({ ...activeEmployee, notes, source: "local" });
    setRefreshKey((x) => x + 1);
  }

  async function removeActivePicture() {
    if (!activeEmployee || !activeEmployee.profilePicture) return;
    if (!confirm("Remove this profile picture?")) return;
    try {
      await deleteEmployeeAsset(activeEmployee.profilePicture);
    } catch (err) {
      console.error("[employee-profile] failed to remove picture from storage:", err);
    }
    upsertEmployee({ ...activeEmployee, profilePicture: undefined, source: "local" });
    setRefreshKey((x) => x + 1);
  }

  async function removeActiveDocument(docId: string) {
    if (!activeEmployee) return;
    const doc = employeeDocs.find((d) => d.id === docId);
    if (!doc) return;
    if (!confirm(`Delete "${doc.fileName}"?`)) return;
    try {
      await removeEmployeeDoc(doc);
      setEmployeeDocs((cur) => cur.filter((d) => d.id !== docId));
    } catch (err) {
      console.error("[employee-profile] failed to remove document:", err);
      alert("Failed to delete document. Check console for details.");
    }
  }

  function handleDelete() {
    if (!activeEmployee) return;
    if (!confirm(`Delete ${activeEmployee.fullName || "this employee"} from the directory?`)) return;
    deleteEmployee(activeEmployee.employeeKey);
    router.push(basePath);
  }

  const backLink = (
    <Link href={basePath} className="secondary" style={{
      display: "inline-block", textDecoration: "none", padding: "6px 12px",
      border: "1px solid var(--border, #e5e7eb)", borderRadius: 6, fontSize: 13,
    }}>
      ← Back to directory
    </Link>
  );

  if (!activeEmployee) {
    return (
      <div className="card" style={{ textAlign: "center", padding: "48px 24px" }}>
        <div style={{ fontSize: 16, marginBottom: 8 }}>Employee not found.</div>
        <div className="muted" style={{ marginBottom: 20, fontSize: 13 }}>
          This record may have been deleted or the link is out of date.
        </div>
        {backLink}
      </div>
    );
  }

  return (
    <div className="grid">
      <div className="action-row hide-print" style={{ justifyContent: "space-between", alignItems: "center" }}>
        {backLink}
        <button type="button" className="secondary" onClick={handleDelete}>Delete Employee</button>
      </div>

      <div className="card">
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 12, flexWrap: "wrap", gap: 12 }}>
          <h2 className="section-title" style={{ margin: 0 }}>Employee Profile{activeEmployee.fullName ? ` — ${activeEmployee.fullName}` : ""}</h2>
          <div className="muted" style={{ fontSize: 13 }}>{activeEmployee.employeeKey}</div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "180px 1fr", gap: 16, alignItems: "start" }}>
          <div className="list-card" style={{ textAlign: "center" }}>
            {activeEmployee.profilePicture ? <img src={activeEmployee.profilePicture} alt="Profile" style={{ width:"100%", maxWidth:160, borderRadius:12 }} /> : <div className="muted" style={{ padding: "32px 8px" }}>No profile picture</div>}
            <div className="hide-print" style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
              <input type="file" accept="image/*" onChange={(e)=>updateActivePicture(e.target.files)} />
              {activeEmployee.profilePicture ? (
                <button type="button" className="secondary" onClick={removeActivePicture} style={{ fontSize: 12, padding: "4px 10px" }}>Remove Picture</button>
              ) : null}
            </div>
          </div>
          <div className="grid2">
            <div><small>Employee Key</small><input value={activeEmployee.employeeKey} onChange={(e)=>updateActiveField("employeeKey", e.target.value)} /></div>
            <div><small>Full Name</small><input value={activeEmployee.fullName} onChange={(e)=>updateActiveField("fullName", e.target.value)} /></div>
            <div><small>First Name</small><input value={activeEmployee.firstName} onChange={(e)=>updateActiveField("firstName", e.target.value)} /></div>
            <div><small>Last Name</small><input value={activeEmployee.lastName} onChange={(e)=>updateActiveField("lastName", e.target.value)} /></div>
            <div><small>Phone</small><input value={activeEmployee.phone || ""} onChange={(e)=>updateActiveField("phone", e.target.value)} /></div>
            <div><small>Email</small><input value={activeEmployee.email || ""} onChange={(e)=>updateActiveField("email", e.target.value)} /></div>
            <div style={{ gridColumn: "1 / -1" }}><small>Address</small><input value={activeEmployee.address || ""} onChange={(e)=>updateActiveField("address", e.target.value)} placeholder="Street address (and apt/suite if applicable)" /></div>
            <div><small>City</small><input value={activeEmployee.city || ""} onChange={(e)=>updateActiveField("city", e.target.value)} /></div>
            <div><small>State</small><select value={activeEmployee.stateCode || ""} onChange={(e)=>updateActiveField("stateCode", e.target.value)}><option value="">— Select —</option>{US_STATES.map((s)=><option key={s} value={s}>{s}</option>)}</select></div>
            <div><small>Zip</small><input value={activeEmployee.zip || ""} onChange={(e)=>updateActiveField("zip", e.target.value)} /></div>
            <div><small>Status</small><input value={activeEmployee.status || ""} onChange={(e)=>updateActiveField("status", e.target.value)} /></div>
            <div>
              <small>Employment Type</small>
              <select value={activeEmployee.employmentType || ""} onChange={(e)=>updateActiveField("employmentType", e.target.value)}>
                <option value="">— Select —</option>
                {employmentTypeOptions.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <small title="Date this person was added to the roster — drives HR's onboarding backlog. Auto-stamped when added on-the-fly from Timekeeping; editable here for backfill or corrections.">
                Hire Date
              </small>
              <input
                type="date"
                value={activeEmployee.hireDate || ""}
                onChange={(e) => updateActiveField("hireDate", e.target.value)}
              />
            </div>
            <div>
              <small title="Rippling employee number. Used by the payroll CSV export to match this person to their Rippling pay run row. Leave blank if not in Rippling.">
                Rippling Emp No
              </small>
              <input
                type="number"
                min="0"
                step="1"
                value={activeEmployee.ripplingEmployeeId ?? ""}
                onChange={(e) => updateActiveField(
                  "ripplingEmployeeId",
                  e.target.value === "" ? null : Number(e.target.value),
                )}
                placeholder="(none)"
              />
            </div>
          </div>
        </div>

        {/* ─── Pay Rate Override (admin-only) ──────────────────────────
            These values override the rate-card default for this employee
            when payroll resolves the pay rate. NULL = "use rate card";
            any set value WINS regardless of rate card. ADMIN-ONLY — never
            shown to crew leaders (hideBill strips the section). */}
        {!hideBill && (
          <div style={{ marginTop: 16 }}>
            <h3 className="section-title">Pay Rate Override</h3>
            <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
              Optional. Leave blank to use the rate card for this employee's
              specialty. Any value entered overrides the rate card — per
              column (set just std to keep OT/DT from rate card, etc.).
            </div>
            <div className="grid grid3" style={{ gap: 12 }}>
              <div>
                <small>Std $/hr</small>
                <input
                  type="number" step="0.01" min="0"
                  placeholder="(rate card)"
                  value={activeEmployee.payStdRate ?? ""}
                  onChange={(e) => updateActiveField(
                    "payStdRate",
                    e.target.value === "" ? null : Number(e.target.value),
                  )}
                />
              </div>
              <div>
                <small>OT $/hr</small>
                <input
                  type="number" step="0.01" min="0"
                  placeholder="(rate card)"
                  value={activeEmployee.payOtRate ?? ""}
                  onChange={(e) => updateActiveField(
                    "payOtRate",
                    e.target.value === "" ? null : Number(e.target.value),
                  )}
                />
              </div>
              <div>
                <small>DT $/hr</small>
                <input
                  type="number" step="0.01" min="0"
                  placeholder="(rate card)"
                  value={activeEmployee.payDtRate ?? ""}
                  onChange={(e) => updateActiveField(
                    "payDtRate",
                    e.target.value === "" ? null : Number(e.target.value),
                  )}
                />
              </div>
            </div>
          </div>
        )}

        <div style={{ marginTop: 16 }}>
          <h3 className="section-title">Notes</h3>
          <textarea value={activeEmployee.notes || ""} onChange={(e)=>saveActiveNotes(e.target.value)} />
        </div>

        <div style={{ marginTop: 16 }}>
          <h3 className="section-title">Certificates / ID / Files</h3>
          <div className="hide-print"><input type="file" multiple onChange={(e)=>updateActiveDocuments(e.target.files)} /></div>
          <div style={{ marginTop: 10 }}>
            {employeeDocs.length === 0 ? (
              <div className="muted">No files uploaded yet.</div>
            ) : (
              <div className="grid">
                {employeeDocs.map((doc) => (
                  <div key={doc.id} className="list-card">
                    <strong>{doc.fileName}</strong>
                    <div className="action-row" style={{ marginTop: 8, gap: 8 }}>
                      {doc.url ? <a className="badge" href={doc.url} target="_blank" rel="noreferrer">View File</a> : null}
                      <button type="button" className="secondary" onClick={() => removeActiveDocument(doc.id)} style={{ fontSize: 12, padding: "4px 10px" }}>Delete</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ── Job History summary ── */}
        {(() => {
          const jobHistory = loadJobSheets()
            .filter((js) => js.workers.some((w) => w.employeeKey === activeEmployee.employeeKey));
          return (
            <div style={{ marginTop: 16 }}>
              <div className="action-row" style={{ marginBottom: 8 }}>
                <h3 className="section-title" style={{ margin: 0, flex: 1 }}>Job History</h3>
                {jobHistory.length > 0 && (
                  <button className="secondary" onClick={() => setHistoryModal("jobs")}>
                    View All ({jobHistory.length})
                  </button>
                )}
              </div>
              {jobHistory.length === 0
                ? <div className="muted">No job sheets found for this employee.</div>
                : <div className="muted">{jobHistory.length} job{jobHistory.length !== 1 ? "s" : ""} assigned — most recent: <strong>{jobHistory.sort((a,b) => b.date.localeCompare(a.date))[0]?.date}</strong></div>
              }
            </div>
          );
        })()}

        {/* ── Timesheet History summary ── */}
        {(() => {
          const tsWithEntries = loadTimesheets()
            .map((ts) => ({ ts, entries: ts.rows.filter((r) => r.employeeKey === activeEmployee.employeeKey) }))
            .filter((x) => x.entries.length > 0);
          const totalHours = tsWithEntries.reduce((sum, x) => sum + x.entries.reduce((s, r) => s + r.totalHours, 0), 0);
          const totalPay = tsWithEntries.reduce((sum, x) => sum + x.entries.reduce((s, r) => s + r.billTotal, 0), 0);
          return (
            <div style={{ marginTop: 16 }}>
              <div className="action-row" style={{ marginBottom: 8 }}>
                <h3 className="section-title" style={{ margin: 0, flex: 1 }}>Timesheet History</h3>
                {tsWithEntries.length > 0 && (
                  <button className="secondary" onClick={() => setHistoryModal("timesheets")}>
                    View All ({tsWithEntries.length})
                  </button>
                )}
              </div>
              {tsWithEntries.length === 0
                ? <div className="muted">No timesheet entries found for this employee.</div>
                : (
                  <div className={hideBill ? "grid2" : "grid3"}>
                    <div className="metric-card"><div className="metric-label">Timesheets</div><div className="metric-value">{tsWithEntries.length}</div></div>
                    <div className="metric-card"><div className="metric-label">Total Hours</div><div className="metric-value">{totalHours.toFixed(1)}</div></div>
                    {!hideBill && (
                      <div className="metric-card"><div className="metric-label">Total Pay</div><div className="metric-value">${totalPay.toFixed(2)}</div></div>
                    )}
                  </div>
                )
              }
            </div>
          );
        })()}
      </div>

      {/* ── History modal ── */}
      {historyModal && (
        <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) setHistoryModal(null); }}>
          <div className="modal-panel">
            <div className="action-row" style={{ marginBottom: 16 }}>
              <h2 className="section-title" style={{ margin: 0, flex: 1 }}>
                {historyModal === "jobs" ? "Job History" : "Timesheet History"} — {activeEmployee.fullName}
              </h2>
              <button className="secondary" onClick={() => setHistoryModal(null)}>Close</button>
            </div>

            {historyModal === "jobs" && (() => {
              const jobHistory = loadJobSheets()
                .filter((js) => js.workers.some((w) => w.employeeKey === activeEmployee.employeeKey))
                .sort((a, b) => b.date.localeCompare(a.date));
              return (
                <div style={{ position: "relative", paddingLeft: 28 }}>
                  {/* timeline spine */}
                  <div style={{ position: "absolute", left: 9, top: 8, bottom: 8, width: 2, background: "var(--line)" }} />
                  {jobHistory.map((js) => {
                    const w = js.workers.find((w) => w.employeeKey === activeEmployee.employeeKey);
                    return (
                      <div key={js.id} style={{ position: "relative", marginBottom: 14 }}>
                        {/* dot */}
                        <div style={{ position: "absolute", left: -23, top: 14, width: 10, height: 10, borderRadius: "50%", background: "var(--gold)", border: "2px solid var(--gold-dark)" }} />
                        <div className="list-card" style={{ padding: "12px 16px" }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                            <div>
                              <div style={{ fontWeight: 700, fontSize: 15, color: "var(--ink)" }}>{js.title || js.eventName}</div>
                              <div style={{ color: "var(--muted)", fontSize: 13, marginTop: 2 }}>{js.client} · {js.venue}</div>
                              {js.cityState && <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 1 }}>{js.cityState}</div>}
                            </div>
                            <div style={{ textAlign: "right", flexShrink: 0 }}>
                              <div style={{ fontSize: 13, fontWeight: 600, color: "var(--gold-dark)" }}>{js.date}</div>
                              {w?.role && <span className="badge" style={{ marginTop: 4, display: "inline-block" }}>{w.role}</span>}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })()}

            {historyModal === "timesheets" && (() => {
              const tsWithEntries = loadTimesheets()
                .map((ts) => ({ ts, entries: ts.rows.filter((r) => r.employeeKey === activeEmployee.employeeKey) }))
                .filter((x) => x.entries.length > 0)
                .sort((a, b) => b.ts.id.localeCompare(a.ts.id));
              const totalHours = tsWithEntries.reduce((sum, x) => sum + x.entries.reduce((s, r) => s + r.totalHours, 0), 0);
              const totalBill  = tsWithEntries.reduce((sum, x) => sum + x.entries.reduce((s, r) => s + r.billTotal, 0), 0);
              return (
                <>
                  <div className={hideBill ? "grid2" : "grid3"} style={{ marginBottom: 16 }}>
                    <div className="metric-card"><div className="metric-label">Timesheets</div><div className="metric-value">{tsWithEntries.length}</div></div>
                    <div className="metric-card"><div className="metric-label">Total Hours</div><div className="metric-value">{totalHours.toFixed(1)}</div></div>
                    {!hideBill && (
                      <div className="metric-card"><div className="metric-label">Total Bill</div><div className="metric-value">${totalBill.toFixed(2)}</div></div>
                    )}
                  </div>
                  <table>
                    <thead><tr><th>Timesheet</th><th>Position</th><th>Std Hrs</th><th>OT Hrs</th><th>DT Hrs</th><th>Total Hrs</th>{!hideBill && <th>Total Bill</th>}</tr></thead>
                    <tbody>
                      {tsWithEntries.map(({ ts, entries }) =>
                        entries.map((r) => (
                          <tr key={r.id}>
                            <td>{ts.title}</td>
                            <td>{r.position || "—"}</td>
                            <td>{r.stdHours.toFixed(1)}</td>
                            <td>{r.otHours.toFixed(1)}</td>
                            <td>{r.dtHours.toFixed(1)}</td>
                            <td>{r.totalHours.toFixed(1)}</td>
                            {!hideBill && <td>${r.billTotal.toFixed(2)}</td>}
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </>
              );
            })()}
          </div>
        </div>
      )}
    </div>
  );
}
