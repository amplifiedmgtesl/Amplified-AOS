/**
 * lib/notifications/providers/index.ts
 *
 * Provider factory. Returns the real vendor adapter when its key/creds are
 * present, otherwise the Mock provider. This single decision is the whole
 * "build now, plug keys in later" mechanism — no calling code branches on it.
 *
 * Server-only (reads secret env vars).
 */

import "server-only";
import { MockEmailProvider, MockSmsProvider } from "./mock";
import { ResendProvider } from "./resend";
import { TwilioProvider } from "./twilio";
import type { EmailProvider, SmsProvider } from "./types";

export function getEmailProvider(): EmailProvider {
  const key = process.env.RESEND_API_KEY;
  return key ? new ResendProvider(key) : new MockEmailProvider();
}

export function getSmsProvider(): SmsProvider {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  return sid && token ? new TwilioProvider(sid, token) : new MockSmsProvider();
}

/** For the status endpoint / test UI — which providers are live vs mock. */
export function getProviderStatus() {
  const email = getEmailProvider();
  const sms = getSmsProvider();
  return {
    email: { provider: email.name, isMock: email.isMock },
    sms: { provider: sms.name, isMock: sms.isMock },
  };
}
