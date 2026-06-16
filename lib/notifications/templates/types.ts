/**
 * lib/notifications/templates/types.ts
 *
 * Template shape. Each event provides per-channel renderers. A channel with
 * no renderer means that event simply isn't sent on that channel (the
 * dispatcher records status='skipped', reason='no_template').
 *
 * Templates are pure functions of (data, recipient) — no I/O, no secrets —
 * so they're trivially unit-testable and safe to import anywhere.
 */

import type { NotificationEvent, NotificationRecipient } from "../types";

export interface RenderedEmail {
  subject: string;
  html: string;
  text?: string;
}

export interface RenderedSms {
  body: string;
}

export interface NotificationTemplate {
  event: NotificationEvent;
  email?: (data: Record<string, unknown>, to: NotificationRecipient) => RenderedEmail;
  sms?: (data: Record<string, unknown>, to: NotificationRecipient) => RenderedSms;
}

/** Minimal HTML wrapper so plain-body emails look intentional, not raw. */
export function wrapHtml(bodyHtml: string): string {
  return `<!doctype html><html><body style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#222;line-height:1.5;">${bodyHtml}</body></html>`;
}

/** Escape user/data-supplied strings before interpolating into HTML. */
export function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
