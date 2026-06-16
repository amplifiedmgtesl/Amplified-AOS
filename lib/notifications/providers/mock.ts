/**
 * lib/notifications/providers/mock.ts
 *
 * No-op providers used whenever a real API key is absent. They log the
 * fully-rendered message to the server console and return a synthetic
 * message id, so the entire pipeline (templating, recipient resolution,
 * notification_log writes, idempotency) can be exercised end-to-end with
 * no Resend/Twilio account.
 *
 * When real keys are added, the factory in ./index.ts swaps these out and
 * nothing else in the codebase changes.
 */

import type {
  EmailMessage,
  EmailProvider,
  SendOutcome,
  SmsMessage,
  SmsProvider,
} from "./types";

let counter = 0;
function mockId(prefix: string): string {
  counter += 1;
  return `${prefix}-${Date.now()}-${counter}`;
}

export class MockEmailProvider implements EmailProvider {
  readonly name = "mock-email";
  readonly isMock = true;

  async send(msg: EmailMessage): Promise<SendOutcome> {
    console.info(
      "[notifications:mock-email] would send:",
      JSON.stringify(
        {
          to: msg.to,
          cc: msg.cc,
          from: msg.from,
          subject: msg.subject,
          attachments: (msg.attachments ?? []).map((a) => a.filename),
          textPreview: (msg.text ?? msg.html).slice(0, 200),
        },
        null,
        2,
      ),
    );
    return { providerMessageId: mockId("mock-email") };
  }
}

export class MockSmsProvider implements SmsProvider {
  readonly name = "mock-sms";
  readonly isMock = true;

  async send(msg: SmsMessage): Promise<SendOutcome> {
    console.info(
      "[notifications:mock-sms] would send:",
      JSON.stringify({ to: msg.to, from: msg.from, body: msg.body }, null, 2),
    );
    return { providerMessageId: mockId("mock-sms") };
  }
}
