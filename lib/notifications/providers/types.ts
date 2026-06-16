/**
 * lib/notifications/providers/types.ts
 *
 * The adapter seam. The dispatcher talks to these interfaces, never to a
 * concrete vendor. This is what makes "build now, plug keys in later"
 * work: with no API key in env, the factory returns a Mock* provider that
 * implements the same interface and logs instead of sending.
 *
 * A provider's send() resolves with a provider message id on success and
 * THROWS on failure (the dispatcher catches and records status='failed').
 */

export interface EmailMessage {
  to: string;
  from: string;
  cc?: string[];
  subject: string;
  html: string;
  text?: string;
  attachments?: Array<{
    filename: string;
    /** base64-encoded bytes */
    content: string;
    contentType?: string;
  }>;
}

export interface SmsMessage {
  to: string; // E.164
  from: string; // E.164 sending number
  body: string;
}

export interface SendOutcome {
  providerMessageId: string | null;
}

export interface EmailProvider {
  /** e.g. "resend" | "mock-email" — recorded in notification_log.provider */
  readonly name: string;
  /** true when this is a no-op/logging provider (no real key configured) */
  readonly isMock: boolean;
  send(msg: EmailMessage): Promise<SendOutcome>;
}

export interface SmsProvider {
  readonly name: string;
  readonly isMock: boolean;
  send(msg: SmsMessage): Promise<SendOutcome>;
}
