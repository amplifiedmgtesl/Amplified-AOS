// Employee asset uploads (profile pictures + document files).
//
// Files go to Supabase Storage bucket `employee-assets` under
// {employeeKey}/profile-* or {employeeKey}/docs/*. The public URL is
// returned and stored in the employees row (profile_picture column or
// documents[].dataUrl field). No more base64 data URLs inside the DB.

import { supabase } from "@/lib/supabase/client";

const BUCKET = "employee-assets";

function safeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function extensionFrom(file: File): string {
  const fromName = file.name.split(".").pop();
  if (fromName && fromName.length <= 5 && /^[a-zA-Z0-9]+$/.test(fromName)) return fromName.toLowerCase();
  const fromType = (file.type || "").split("/").pop();
  return (fromType && /^[a-zA-Z0-9]+$/.test(fromType) ? fromType : "bin").toLowerCase();
}

/**
 * Upload a profile picture. Returns the public URL ready for <img src>.
 */
export async function uploadProfilePicture(employeeKey: string, file: File): Promise<string> {
  const path = `${employeeKey}/profile-${Date.now()}.${extensionFrom(file)}`;
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, { upsert: true, contentType: file.type || "application/octet-stream" });
  if (error) throw error;
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

/**
 * Upload an employee document (cert, ID, etc.). Returns the public URL.
 */
export async function uploadEmployeeDocument(employeeKey: string, file: File): Promise<string> {
  const path = `${employeeKey}/docs/${Date.now()}-${safeName(file.name)}`;
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, { upsert: false, contentType: file.type || "application/octet-stream" });
  if (error) throw error;
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

/**
 * Delete a previously-uploaded asset from the bucket. Accepts either the
 * public URL stored on the employee record or a bare storage path. Silently
 * no-ops for legacy base64 data URLs and for anything we can't locate.
 */
export async function deleteEmployeeAsset(urlOrPath: string): Promise<void> {
  if (!urlOrPath) return;
  if (urlOrPath.startsWith("data:")) return; // legacy inline, nothing in storage
  let path = urlOrPath;
  // Extract path from a Supabase public URL:
  //   https://<proj>.supabase.co/storage/v1/object/public/employee-assets/<path>
  const match = urlOrPath.match(/\/employee-assets\/(.+?)(\?|$)/);
  if (match) path = match[1];
  const { error } = await supabase.storage.from(BUCKET).remove([path]);
  if (error) console.error("[storage] remove failed:", error, path);
}

// ── One-time migration: base64 data URLs → Storage ─────────────────────────────

function dataUrlToBlob(dataUrl: string): { blob: Blob; ext: string } | null {
  const m = dataUrl.match(/^data:([^;,]+);base64,(.+)$/);
  if (!m) return null;
  const mime = m[1];
  const bin = atob(m[2]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const ext = (mime.split("/").pop() || "bin").toLowerCase().replace(/[^a-z0-9]/g, "") || "bin";
  return { blob: new Blob([bytes], { type: mime }), ext };
}

async function uploadBlob(path: string, blob: Blob): Promise<string | null> {
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, blob, { upsert: true, contentType: blob.type || "application/octet-stream" });
  if (error) { console.error("[storage] upload failed:", error, path); return null; }
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

/**
 * Migrate a single employee row's profile_picture + documents[].dataUrl from
 * inline base64 data URLs to Storage. Returns the updated
 * profilePicture / documents pair (or null if nothing changed).
 */
export async function migrateEmployeeMedia(row: {
  employeeKey: string;
  profilePicture?: string;
  documents?: { id: string; name: string; dataUrl?: string }[];
}): Promise<{ profilePicture?: string; documents?: { id: string; name: string; dataUrl?: string }[] } | null> {
  let changed = false;
  let profilePicture = row.profilePicture;
  const documents = [...(row.documents || [])];

  // Profile picture
  if (profilePicture && profilePicture.startsWith("data:")) {
    const parsed = dataUrlToBlob(profilePicture);
    if (parsed) {
      const url = await uploadBlob(`${row.employeeKey}/profile-${Date.now()}.${parsed.ext}`, parsed.blob);
      if (url) { profilePicture = url; changed = true; }
    }
  }

  // Documents
  for (let i = 0; i < documents.length; i++) {
    const d = documents[i];
    if (d?.dataUrl && d.dataUrl.startsWith("data:")) {
      const parsed = dataUrlToBlob(d.dataUrl);
      if (parsed) {
        const url = await uploadBlob(
          `${row.employeeKey}/docs/${Date.now()}-${i}-${safeName(d.name || "file." + parsed.ext)}`,
          parsed.blob,
        );
        if (url) { documents[i] = { ...d, dataUrl: url }; changed = true; }
      }
    }
  }

  return changed ? { profilePicture, documents } : null;
}
