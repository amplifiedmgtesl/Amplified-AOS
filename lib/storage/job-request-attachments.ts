// Job-request attachment uploads. Files (diagrams, maps, scope packets, etc.)
// go to Supabase Storage bucket `job-request-attachments` under
// {jobRequestId}/{timestamp}-{safe filename}. The public URL is stored as a
// string in the job_requests.attachment_names jsonb array.

import { supabase } from "@/lib/supabase/client";

const BUCKET = "job-request-attachments";

function safeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}

/**
 * Upload a single attachment. Returns the public URL ready to store on the
 * job_request and use as an <a href>.
 */
export async function uploadJobRequestAttachment(jobRequestId: string, file: File): Promise<string> {
  const path = `${jobRequestId}/${Date.now()}-${safeName(file.name)}`;
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, { upsert: false, contentType: file.type || "application/octet-stream" });
  if (error) throw error;
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

/**
 * Delete an attachment from the bucket. Accepts either the public URL or a
 * bare storage path. No-ops on anything outside this bucket.
 */
export async function deleteJobRequestAttachment(urlOrPath: string): Promise<void> {
  if (!urlOrPath) return;
  let path = urlOrPath;
  const match = urlOrPath.match(/\/job-request-attachments\/(.+?)(\?|$)/);
  if (match) path = match[1];
  const { error } = await supabase.storage.from(BUCKET).remove([path]);
  if (error) console.error("[storage] remove failed:", error, path);
}

/**
 * Pull just the user-visible filename out of a stored URL.
 *   ".../job-request-attachments/jr-123/1764000000-floor_plan.pdf"
 *   → "floor_plan.pdf"
 * Falls back to the full URL if it can't parse.
 */
export function attachmentDisplayName(urlOrPath: string): string {
  if (!urlOrPath) return "";
  const last = urlOrPath.split("/").pop() ?? urlOrPath;
  // Strip the leading "{timestamp}-" prefix we add on upload.
  const m = last.match(/^\d{10,}-(.+)$/);
  return m ? m[1] : last;
}
