/**
 * lib/notifications/config.ts
 *
 * Server-only. Reads notification settings from env. Importing this on the
 * client would be a mistake — it's only referenced by dispatch.ts / the API
 * route / the provider factory.
 */

import "server-only";

export interface NotificationConfig {
  /** Hard kill-switch. When false, messages are logged (status='queued') but never sent. */
  enabled: boolean;
  /** Verified sending address, e.g. "noreply@amplifiedesl.com". */
  fromEmail: string;
  /** Always-CC address for the paper trail (e.g. John). Empty = no auto-CC. */
  ccEmail: string | null;
  /** Twilio sending number, E.164. */
  smsFrom: string | null;
}

export function getConfig(): NotificationConfig {
  return {
    // Default ON; set NOTIFICATIONS_ENABLED=false to log-only.
    // (Even when ON, absence of provider keys means the Mock providers
    //  run — see providers/index.ts — so "ON" is still safe with no keys.)
    enabled: process.env.NOTIFICATIONS_ENABLED !== "false",
    fromEmail: process.env.NOTIFICATIONS_FROM_EMAIL || "noreply@example.com",
    ccEmail: process.env.NOTIFICATIONS_CC_EMAIL || null,
    smsFrom: process.env.TWILIO_FROM_NUMBER || null,
  };
}
