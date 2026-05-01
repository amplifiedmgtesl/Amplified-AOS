"use client";

import { useEffect, useState } from "react";
import {
  loadAttachments,
  uploadAttachment,
  updateAttachmentMeta,
  removeAttachment,
  DOC_TYPE_OPTIONS,
} from "@/lib/storage/job-request-attachments";
import type { JobRequestAttachment, JobRequestAttachmentType } from "@/lib/store/types";

const COL_GRID = "110px 1fr 1.4fr 90px 60px";

function formatSize(bytes?: number): string {
  if (!bytes && bytes !== 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function JobRequestAttachmentsSection({ jobRequestId, hideHeader = false }: { jobRequestId: string; hideHeader?: boolean }) {
  const [items, setItems] = useState<JobRequestAttachment[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  async function reload() {
    setLoading(true);
    try {
      setItems(await loadAttachments(jobRequestId));
    } catch (err: any) {
      setMsg({ text: `Load failed: ${err?.message ?? err}`, ok: false });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void reload(); /* eslint-disable-line react-hooks/exhaustive-deps */ }, [jobRequestId]);

  async function handleUpload(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    setMsg(null);
    let added = 0;
    try {
      for (const f of Array.from(files)) {
        await uploadAttachment(jobRequestId, f);
        added++;
      }
      setMsg({ text: `Uploaded ${added} file${added !== 1 ? "s" : ""}.`, ok: true });
      await reload();
    } catch (err: any) {
      setMsg({ text: `Upload failed: ${err?.message ?? err}`, ok: false });
    } finally {
      setUploading(false);
    }
  }

  async function patch(id: string, patchFields: Partial<Pick<JobRequestAttachment, "description" | "docType">>) {
    // Optimistic update so typing feels snappy.
    setItems((prev) => prev.map((a) => (a.id === id ? { ...a, ...patchFields } : a)));
    try {
      await updateAttachmentMeta(id, patchFields);
    } catch (err: any) {
      setMsg({ text: `Save failed: ${err?.message ?? err}`, ok: false });
      await reload();
    }
  }

  async function handleRemove(att: JobRequestAttachment) {
    if (!confirm(`Remove "${att.fileName}"?`)) return;
    setMsg(null);
    try {
      await removeAttachment(att);
      await reload();
    } catch (err: any) {
      setMsg({ text: `Remove failed: ${err?.message ?? err}`, ok: false });
    }
  }

  return (
    <div style={hideHeader
      ? { marginTop: 4 }
      : { marginTop: 16, paddingTop: 12, borderTop: "1px solid var(--border, #e5e7eb)" }
    }>
      {!hideHeader && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
          <h3 style={{ margin: 0, fontSize: 14 }}>Attachments</h3>
          <span className="muted" style={{ fontSize: 11 }}>
            Diagrams, floor plans, scope packets — anything the client sends.
          </span>
        </div>
      )}

      {/* Header row */}
      {(loading || items.length > 0) && (
        <div style={{
          display: "grid", gridTemplateColumns: COL_GRID, gap: 6,
          padding: "0 4px 4px", fontSize: 11, color: "#666", fontWeight: 600,
          borderBottom: "1px solid var(--border, #e5e7eb)",
        }}>
          <div>Type</div>
          <div>File</div>
          <div>Description</div>
          <div>Size</div>
          <div></div>
        </div>
      )}

      {/* Body */}
      <div style={{ display: "flex", flexDirection: "column", gap: 4, padding: "6px 0" }}>
        {loading ? (
          <div style={{ color: "#888", fontSize: 12, padding: 8 }}>Loading…</div>
        ) : items.length === 0 ? (
          <div style={{ color: "#888", fontSize: 13, padding: "8px 0" }}>No attachments yet.</div>
        ) : (
          items.map((a) => (
            <div
              key={a.id}
              style={{
                display: "grid", gridTemplateColumns: COL_GRID, gap: 6, alignItems: "center",
                padding: "6px 4px", borderBottom: "1px solid var(--border-faint, #f1f3f5)", fontSize: 12,
              }}
            >
              <select
                value={a.docType}
                onChange={(e) => void patch(a.id, { docType: e.target.value as JobRequestAttachmentType })}
                style={{ width: "100%", fontSize: 12, padding: "3px 4px" }}
              >
                {DOC_TYPE_OPTIONS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
              <a
                href={a.url}
                target="_blank"
                rel="noreferrer"
                title={a.fileName}
                style={{
                  color: "var(--accent, #2563eb)",
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}
              >
                📎 {a.fileName}
              </a>
              <input
                value={a.description ?? ""}
                onChange={(e) => setItems((prev) => prev.map((x) => x.id === a.id ? { ...x, description: e.target.value } : x))}
                onBlur={(e) => void patch(a.id, { description: e.target.value })}
                placeholder="optional description"
                style={{ width: "100%", fontSize: 12, padding: "3px 6px" }}
              />
              <div style={{ color: "#555" }}>{formatSize(a.fileSize)}</div>
              <button
                className="secondary"
                onClick={() => void handleRemove(a)}
                title="Remove attachment"
                style={{ fontSize: 11, padding: "3px 8px", color: "#c33", justifySelf: "end" }}
              >
                ×
              </button>
            </div>
          ))
        )}
      </div>

      <label
        style={{
          display: "inline-flex", alignItems: "center", gap: 6,
          cursor: uploading ? "wait" : "pointer",
          padding: "6px 12px", border: "1px dashed var(--border, #b5b9c0)",
          borderRadius: 6, fontSize: 13, color: "#3c4043",
          opacity: uploading ? 0.6 : 1, marginTop: 4,
        }}
      >
        {uploading ? "Uploading…" : "+ Upload File(s)"}
        <input
          type="file"
          multiple
          style={{ display: "none" }}
          disabled={uploading}
          onChange={(e) => {
            void handleUpload(e.target.files);
            e.target.value = "";
          }}
        />
      </label>
      {msg && (
        <span style={{
          marginLeft: 12, fontSize: 12,
          color: msg.ok ? "#06633a" : "#a00",
        }}>
          {msg.text}
        </span>
      )}
    </div>
  );
}
