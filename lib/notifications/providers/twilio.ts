/**
 * lib/notifications/providers/twilio.ts
 *
 * Real SMS provider — Twilio Messages API. Uses fetch + Basic auth (no SDK).
 * Constructed by the factory in ./index.ts when Twilio creds are present.
 *
 * Reminder: US business SMS requires A2P 10DLC brand + campaign registration
 * (carrier-mandated, days–weeks lead time). Until the campaign is approved,
 * Twilio may filter/queue messages even with valid creds.
 */

import type { SendOutcome, SmsMessage, SmsProvider } from "./types";

export class TwilioProvider implements SmsProvider {
  readonly name = "twilio";
  readonly isMock = false;

  constructor(
    private readonly accountSid: string,
    private readonly authToken: string,
  ) {}

  async send(msg: SmsMessage): Promise<SendOutcome> {
    const endpoint = `https://api.twilio.com/2010-04-01/Accounts/${this.accountSid}/Messages.json`;
    const form = new URLSearchParams({
      To: msg.to,
      From: msg.from,
      Body: msg.body,
    });

    // Basic auth: base64("sid:token"). btoa is available in the Next.js runtime.
    const credentials =
      typeof btoa === "function"
        ? btoa(`${this.accountSid}:${this.authToken}`)
        : Buffer.from(`${this.accountSid}:${this.authToken}`).toString("base64");

    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form.toString(),
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const message = (json && json.message) || `Twilio HTTP ${res.status}`;
      throw new Error(`Twilio send failed: ${message}`);
    }
    return { providerMessageId: (json && json.sid) || null };
  }
}
