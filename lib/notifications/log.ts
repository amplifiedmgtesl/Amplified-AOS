/**
 * lib/notifications/log.ts
 *
 * notification_log writer + idempotency lookup. Server-only (uses the
 * service-role client). Every send attempt — sent, failed, skipped, or
 * queued — produces exactly one row here.
 */

import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { ChannelStatus, NotificationChannel, SkipReason } from "./types";

export interface LogRow {
  event_type: string;
  channel: NotificationChannel;
  entity_type: string | null;
  entity_id: string | null;
  to_address: string | null;
  cc: string | null;
  subject: string | null;
  body_snippet: string | null;
  attachment_path: string | null;
  status: ChannelStatus;
  skip_reason: SkipReason | null;
  provider: string | null;
  provider_message_id: string | null;
  error: string | null;
  idempotency_key: string | null;
  sent_at: string | null;
}

function newId(): string {
  return `nlog-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Insert a finished log row. Returns the row id (or null if the insert failed). */
export async function writeLog(row: LogRow): Promise<string | null> {
  const id = newId();
  const { error } = await supabaseAdmin.from("notification_log").insert({ id, ...row });
  if (error) {
    // Logging must never break sending — surface to server console only.
    console.error("[notifications] notification_log insert failed:", error.message);
    return null;
  }
  return id;
}

/**
 * Idempotency: has a message with this key already been SENT?
 * Skipped/failed/queued rows don't suppress a retry — only a confirmed send does.
 */
export async function alreadySent(idempotencyKey: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from("notification_log")
    .select("id")
    .eq("idempotency_key", idempotencyKey)
    .eq("status", "sent")
    .limit(1);
  if (error) {
    console.error("[notifications] idempotency check failed:", error.message);
    return false; // fail open — better a possible double-send than a silent drop
  }
  return (data?.length ?? 0) > 0;
}
