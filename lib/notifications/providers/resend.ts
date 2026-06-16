/**
 * lib/notifications/providers/resend.ts
 *
 * Real email provider — Resend HTTP API (https://resend.com/docs).
 * Uses fetch only (no SDK dependency). Constructed by the factory in
 * ./index.ts when RESEND_API_KEY is present.
 *
 * NOTE: AOS uses a SEPARATE, client-owned Resend account (AOS is a client).
 * The key lives in AOS's own env, not shared with any other project.
 */

import type { EmailMessage, EmailProvider, SendOutcome } from "./types";

const RESEND_ENDPOINT = "https://api.resend.com/emails";

export class ResendProvider implements EmailProvider {
  readonly name = "resend";
  readonly isMock = false;

  constructor(private readonly apiKey: string) {}

  async send(msg: EmailMessage): Promise<SendOutcome> {
    const body: Record<string, unknown> = {
      from: msg.from,
      to: [msg.to],
      subject: msg.subject,
      html: msg.html,
    };
    if (msg.text) body.text = msg.text;
    if (msg.cc && msg.cc.length) body.cc = msg.cc;
    if (msg.attachments && msg.attachments.length) {
      body.attachments = msg.attachments.map((a) => ({
        filename: a.filename,
        content: a.content, // base64
        ...(a.contentType ? { content_type: a.contentType } : {}),
      }));
    }

    const res = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const message =
        (json && (json.message || json.error)) || `Resend HTTP ${res.status}`;
      throw new Error(`Resend send failed: ${message}`);
    }
    return { providerMessageId: (json && json.id) || null };
  }
}
