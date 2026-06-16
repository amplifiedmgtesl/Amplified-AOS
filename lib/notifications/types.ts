/**
 * lib/notifications/types.ts
 *
 * The public contract of the notifications module. Feature modules
 * (crew, quotes, invoices, …) import ONLY from here — they never touch
 * Resend, Twilio, or the notification_log directly.
 *
 * This file is pure types + constants and is safe to import from client
 * components (e.g. the test UI). The actual send path (dispatch.ts,
 * providers/*, log.ts) is server-only.
 */

export type NotificationChannel = "email" | "sms";

/**
 * Known events. Add a new member here AND register a template for it in
 * lib/notifications/templates/index.ts — the registry is type-checked
 * against this union, so a missing template is a compile error.
 */
export type NotificationEvent =
  | "crew_assigned"
  | "quote_issued"
  | "invoice_issued"
  | "internal_alert";

export interface NotificationRecipient {
  /** Email address. Required if "email" is in channels. */
  email?: string | null;
  /** Phone number, E.164 preferred (+1XXXXXXXXXX). Required if "sms" is in channels. */
  phone?: string | null;
  /** Display name, available to templates. */
  name?: string | null;
  /** If true, SMS is skipped for this recipient (honor opt-out). */
  smsOptOut?: boolean;
}

export interface NotificationAttachment {
  filename: string;
  contentType?: string; // e.g. "application/pdf"
  /** Provide exactly one of the following two: */
  contentBase64?: string; // raw bytes, base64-encoded
  storagePath?: string; // key in the notification-documents Storage bucket (server fetches the bytes)
}

export interface NotifyInput {
  event: NotificationEvent;
  /** Which channels to attempt. Each is independent; one can succeed while another skips. */
  channels: NotificationChannel[];
  to: NotificationRecipient;
  /** Email CC list (ignored for SMS). The default John-CC is added by the dispatcher. */
  cc?: string[];
  /** Template variables. Shape is per-event (see the event's template module). */
  data: Record<string, unknown>;
  /** Email attachments (ignored for SMS). */
  attachments?: NotificationAttachment[];
  /** Source row this notification is about — used for the audit log + idempotency. */
  entity?: { type: string; id: string };
  /**
   * Override the idempotency key. Default:
   *   `${event}:${entity?.type}:${entity?.id}:${channel}:${address}`
   * A prior row with the same key and status='sent' suppresses a re-send.
   * Pass a unique value (or omit entity) to force a fresh send.
   */
  idempotencyKey?: string;
}

export type ChannelStatus = "sent" | "failed" | "skipped" | "queued";

export type SkipReason =
  | "disabled" // NOTIFICATIONS_ENABLED=false — logged but not sent
  | "duplicate" // already sent (idempotency)
  | "no_address" // recipient has no email/phone for this channel
  | "opted_out" // recipient.smsOptOut
  | "no_template"; // event has no renderer for this channel

export interface NotifyChannelResult {
  channel: NotificationChannel;
  to: string | null;
  status: ChannelStatus;
  provider?: string;
  providerMessageId?: string | null;
  error?: string | null;
  skipReason?: SkipReason;
  logId?: string;
}

export interface NotifyResult {
  results: NotifyChannelResult[];
}

/** Human-friendly labels for the test UI / audit views. */
export const EVENT_LABELS: Record<NotificationEvent, string> = {
  crew_assigned: "Crew assignment / confirmation",
  quote_issued: "Quote issued",
  invoice_issued: "Invoice issued",
  internal_alert: "Internal staff/IT alert",
};
