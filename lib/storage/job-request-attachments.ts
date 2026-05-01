// Job-request attachment uploads + metadata. Files go to Supabase Storage
// bucket `job-request-attachments` under {jobRequestId}/{timestamp}-{safe
// filename}. Metadata (description, doc type, etc.) lives in the
// `job_request_attachments` table — one row per file.

import { supabase } from "@/lib/supabase/client";
import type { JobRequestAttachment, JobRequestAttachmentType } from "@/lib/store/types";

const BUCKET = "job-request-attachments";

function safeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function newId(): string {
  return `jra-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function rowToAttachment(r: any): JobRequestAttachment {
  return {
    id: r.id,
    jobRequestId: r.job_request_id,
    storagePath: r.storage_path ?? "",
    url: r.url ?? "",
    fileName: r.file_name ?? "",
    description: r.description ?? undefined,
    docType: (r.doc_type as JobRequestAttachmentType) ?? "other",
    mimeType: r.mime_type ?? undefined,
    fileSize: r.file_size ?? undefined,
    uploadedAt: r.uploaded_at ?? "",
    isActive: r.is_active ?? true,
  };
}

/**
 * Upload a single file and create the metadata row. Returns the persisted
 * attachment.
 */
export async function uploadAttachment(
  jobRequestId: string,
  file: File,
  initial?: Partial<Pick<JobRequestAttachment, "description" | "docType">>,
): Promise<JobRequestAttachment> {
  const storagePath = `${jobRequestId}/${Date.now()}-${safeName(file.name)}`;
  const upload = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, file, { upsert: false, contentType: file.type || "application/octet-stream" });
  if (upload.error) throw upload.error;
  const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(storagePath);
  const row = {
    id: newId(),
    job_request_id: jobRequestId,
    storage_path: storagePath,
    url: urlData.publicUrl,
    file_name: file.name,
    description: initial?.description ?? null,
    doc_type: initial?.docType ?? "other",
    mime_type: file.type || null,
    file_size: file.size || null,
    is_active: true,
  };
  const { data, error } = await supabase
    .from("job_request_attachments")
    .insert(row)
    .select()
    .single();
  if (error) {
    // Best-effort cleanup of the bytes if metadata insert failed.
    await supabase.storage.from(BUCKET).remove([storagePath]).catch(() => {});
    throw error;
  }
  return rowToAttachment(data);
}

/**
 * Update mutable fields (description, docType, file_name) on an existing
 * attachment row. Returns the refreshed row.
 */
export async function updateAttachmentMeta(
  id: string,
  patch: Partial<Pick<JobRequestAttachment, "description" | "docType" | "fileName">>,
): Promise<JobRequestAttachment> {
  const dbPatch: Record<string, unknown> = {};
  if (patch.description !== undefined) dbPatch.description = patch.description || null;
  if (patch.docType !== undefined) dbPatch.doc_type = patch.docType;
  if (patch.fileName !== undefined) dbPatch.file_name = patch.fileName;
  const { data, error } = await supabase
    .from("job_request_attachments")
    .update(dbPatch)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return rowToAttachment(data);
}

/**
 * Soft-delete an attachment row + remove the bytes from Storage.
 */
export async function removeAttachment(att: JobRequestAttachment): Promise<void> {
  // Delete the storage object first (best effort).
  await supabase.storage.from(BUCKET).remove([att.storagePath]).catch((e) => {
    console.error("[storage] remove failed:", e, att.storagePath);
  });
  // Soft-delete the metadata row so referencing UI can still resolve names if needed.
  const { error } = await supabase
    .from("job_request_attachments")
    .update({ is_active: false })
    .eq("id", att.id);
  if (error) throw error;
}

/**
 * Fetch active attachments for a job request, newest first.
 */
export async function loadAttachments(jobRequestId: string): Promise<JobRequestAttachment[]> {
  const { data, error } = await supabase
    .from("job_request_attachments")
    .select("*")
    .eq("job_request_id", jobRequestId)
    .eq("is_active", true)
    .order("uploaded_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map(rowToAttachment);
}

export const DOC_TYPE_OPTIONS: { value: JobRequestAttachmentType; label: string }[] = [
  { value: "diagram",      label: "Diagram" },
  { value: "floor_plan",   label: "Floor Plan" },
  { value: "map",          label: "Map" },
  { value: "scope_packet", label: "Scope Packet" },
  { value: "contract",     label: "Contract" },
  { value: "photo",        label: "Photo" },
  { value: "other",        label: "Other" },
];
