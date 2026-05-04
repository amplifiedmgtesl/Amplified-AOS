// Employee document uploads + metadata. Files go to Supabase Storage bucket
// `employee-assets` under {employeeKey}/docs/{timestamp}-{safe filename}.
// Metadata (description, doc type, size, etc.) lives in the
// `employee_documents` table — one row per file.
//
// This is the canonical pattern for any per-entity document/attachment
// feature in the app. Mirrors job_request_attachments. New features
// should follow this shape (table + storage path + helper) — NOT jsonb
// arrays inside the parent row.

import { supabase } from "@/lib/supabase/client";

export type EmployeeDocumentType =
  | "w9" | "i9" | "id" | "contract" | "certification"
  | "resume" | "photo" | "other";

export type EmployeeDocument = {
  id: string;
  employeeKey: string;
  storagePath: string;
  url: string;
  fileName: string;
  description?: string;
  docType: EmployeeDocumentType;
  mimeType?: string;
  fileSize?: number;
  uploadedAt: string;
  isActive: boolean;
};

const BUCKET = "employee-assets";

function safeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function newId(): string {
  return `empdoc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function rowToDocument(r: any): EmployeeDocument {
  return {
    id: r.id,
    employeeKey: r.employee_key,
    storagePath: r.storage_path ?? "",
    url: r.url ?? "",
    fileName: r.file_name ?? "",
    description: r.description ?? undefined,
    docType: (r.doc_type as EmployeeDocumentType) ?? "other",
    mimeType: r.mime_type ?? undefined,
    fileSize: r.file_size ?? undefined,
    uploadedAt: r.uploaded_at ?? "",
    isActive: r.is_active ?? true,
  };
}

/** Upload a single file + create the metadata row. Returns the persisted record. */
export async function uploadDocument(
  employeeKey: string,
  file: File,
  initial?: Partial<Pick<EmployeeDocument, "description" | "docType">>,
): Promise<EmployeeDocument> {
  const storagePath = `${employeeKey}/docs/${Date.now()}-${safeName(file.name)}`;
  const upload = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, file, { upsert: false, contentType: file.type || "application/octet-stream" });
  if (upload.error) throw upload.error;
  const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(storagePath);
  const row = {
    id: newId(),
    employee_key: employeeKey,
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
    .from("employee_documents")
    .insert(row)
    .select()
    .single();
  if (error) {
    // Best-effort cleanup of bytes if metadata insert failed.
    await supabase.storage.from(BUCKET).remove([storagePath]).catch(() => {});
    throw error;
  }
  return rowToDocument(data);
}

/** Update mutable fields on an existing document row. */
export async function updateDocumentMeta(
  id: string,
  patch: Partial<Pick<EmployeeDocument, "description" | "docType" | "fileName">>,
): Promise<EmployeeDocument> {
  const dbPatch: Record<string, unknown> = {};
  if (patch.description !== undefined) dbPatch.description = patch.description || null;
  if (patch.docType !== undefined) dbPatch.doc_type = patch.docType;
  if (patch.fileName !== undefined) dbPatch.file_name = patch.fileName;
  const { data, error } = await supabase
    .from("employee_documents")
    .update(dbPatch)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return rowToDocument(data);
}

/** Soft-delete (is_active=false) + remove bytes from Storage. */
export async function removeDocument(doc: EmployeeDocument): Promise<void> {
  await supabase.storage.from(BUCKET).remove([doc.storagePath]).catch((e) => {
    console.error("[employee-documents] storage remove failed:", e, doc.storagePath);
  });
  const { error } = await supabase
    .from("employee_documents")
    .update({ is_active: false })
    .eq("id", doc.id);
  if (error) throw error;
}

/** Fetch active documents for an employee, newest first. */
export async function loadDocuments(employeeKey: string): Promise<EmployeeDocument[]> {
  const { data, error } = await supabase
    .from("employee_documents")
    .select("*")
    .eq("employee_key", employeeKey)
    .eq("is_active", true)
    .order("uploaded_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map(rowToDocument);
}

export const DOC_TYPE_OPTIONS: { value: EmployeeDocumentType; label: string }[] = [
  { value: "w9",            label: "W-9"            },
  { value: "i9",            label: "I-9"            },
  { value: "id",            label: "ID / License"   },
  { value: "contract",      label: "Contract"       },
  { value: "certification", label: "Certification"  },
  { value: "resume",        label: "Resume"         },
  { value: "photo",         label: "Photo"          },
  { value: "other",         label: "Other"          },
];
