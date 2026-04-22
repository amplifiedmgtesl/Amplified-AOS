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
