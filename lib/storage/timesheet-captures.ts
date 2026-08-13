// Time Clock audit layer — timesheet_captures + signature storage.
//
// The kiosk writes the SAME timesheet_entries.time_in1..out2 fields the crew
// leader types (via the normal upsertTimesheet path, so records are identical).
// This module writes the audit/provenance layer underneath: the RAW capture
// instant per slot and the sign-in signature images. Provenance on the
// timekeeping screen (Phase 2) is derived by comparing these actual_* instants
// against the rounded time_* values.
//
// Signatures live in the PRIVATE `timeclock-signatures` bucket; reads (live
// view / PDF) use short-lived signed URLs, added in Phase 2/3.

import { supabase } from "@/lib/supabase/client";

const BUCKET = "timeclock-signatures";

export type TimesheetCapture = {
  timesheetEntryId: string;
  actualIn1: string | null;
  actualOut1: string | null;
  actualIn2: string | null;
  actualOut2: string | null;
  signatureIn1Path: string | null;
  signatureIn2Path: string | null;
  captureTz: string | null;
  capturedEmployeeKey: string | null;
};

/** Upload a signature PNG for a sign-in slot; returns the stored object path. */
export async function uploadSignature(
  entryId: string,
  slot: "in1" | "in2",
  blob: Blob,
): Promise<string> {
  // Path is scoped under the entry id + timestamp so it's stable and unguessable.
  const path = `${entryId}/${slot}-${Date.now()}.png`;
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, blob, { upsert: true, contentType: "image/png" });
  if (error) throw error;
  return path;
}

export type CapturePatch = {
  actualIn1?: string;
  actualOut1?: string;
  actualIn2?: string;
  actualOut2?: string;
  signatureIn1Path?: string;
  signatureIn2Path?: string;
  captureTz?: string;
  capturedEmployeeKey?: string | null;
};

/**
 * Upsert the capture (audit) row for a timesheet entry with a partial patch.
 * PostgREST upserts update only the columns present in the payload, so prior
 * slots/signatures are preserved across successive punches.
 */
export async function upsertCapture(entryId: string, patch: CapturePatch): Promise<void> {
  const row: Record<string, unknown> = {
    timesheet_entry_id: entryId,
    updated_at: new Date().toISOString(),
  };
  if (patch.actualIn1 !== undefined) row.actual_in1 = patch.actualIn1;
  if (patch.actualOut1 !== undefined) row.actual_out1 = patch.actualOut1;
  if (patch.actualIn2 !== undefined) row.actual_in2 = patch.actualIn2;
  if (patch.actualOut2 !== undefined) row.actual_out2 = patch.actualOut2;
  if (patch.signatureIn1Path !== undefined) row.signature_in1_path = patch.signatureIn1Path;
  if (patch.signatureIn2Path !== undefined) row.signature_in2_path = patch.signatureIn2Path;
  if (patch.captureTz !== undefined) row.capture_tz = patch.captureTz;
  if (patch.capturedEmployeeKey !== undefined) row.captured_employee_key = patch.capturedEmployeeKey;

  const { error } = await supabase
    .from("timesheet_captures")
    .upsert(row, { onConflict: "timesheet_entry_id" });
  if (error) throw error;
}

/** Load capture rows for a set of entry ids (for provenance / audit display). */
export async function loadCaptures(entryIds: string[]): Promise<Map<string, TimesheetCapture>> {
  const map = new Map<string, TimesheetCapture>();
  if (entryIds.length === 0) return map;
  const { data, error } = await supabase
    .from("timesheet_captures")
    .select("*")
    .in("timesheet_entry_id", entryIds);
  if (error) {
    console.error("[timesheet-captures] loadCaptures:", error);
    return map;
  }
  for (const r of data ?? []) {
    map.set(r.timesheet_entry_id, {
      timesheetEntryId: r.timesheet_entry_id,
      actualIn1: r.actual_in1 ?? null,
      actualOut1: r.actual_out1 ?? null,
      actualIn2: r.actual_in2 ?? null,
      actualOut2: r.actual_out2 ?? null,
      signatureIn1Path: r.signature_in1_path ?? null,
      signatureIn2Path: r.signature_in2_path ?? null,
      captureTz: r.capture_tz ?? null,
      capturedEmployeeKey: r.captured_employee_key ?? null,
    });
  }
  return map;
}

/**
 * Short-lived signed URLs for signature images, keyed by storage path.
 *
 * The bucket is PRIVATE, so a signature can only be rendered through a signed
 * URL — there is no public link to fall back on. Used by the printed actuals
 * document (#46c) and, later, the client-facing PDF (kiosk spec Phase 2).
 *
 * Failures are swallowed to a missing entry rather than thrown: a signature
 * that will not load must not take the whole timesheet down, and the document
 * already has to render honestly for rows that were hand-entered and never had
 * a signature at all.
 */
export async function signSignatureUrls(
  paths: string[],
  expiresInSeconds = 3600,
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const unique = Array.from(new Set(paths.filter(Boolean)));
  if (unique.length === 0) return map;
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrls(unique, expiresInSeconds);
  if (error) {
    console.error("[timesheet-captures] signSignatureUrls:", error);
    return map;
  }
  for (const r of data ?? []) {
    if (r.signedUrl && r.path) map.set(r.path, r.signedUrl);
  }
  return map;
}
