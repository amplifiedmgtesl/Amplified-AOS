/**
 * lib/notifications/dispatch.ts
 *
 * The module's single public entry point: notify(). Feature modules call
 * this and nothing else. It is channel- and vendor-agnostic — it renders
 * the event's template, resolves the recipient per channel, enforces
 * idempotency + opt-out + the kill-switch, sends via whichever provider is
 * configured (real or mock), and writes one notification_log row per channel.
 *
 * Server-only. Import from a server action / API route / edge handler.
 */

import "server-only";
import { getConfig } from "./config";
import { alreadySent, writeLog, type LogRow } from "./log";
import { getEmailProvider, getSmsProvider } from "./providers";
import { getTemplate } from "./templates";
import type {
  NotifyChannelResult,
  NotifyInput,
  NotifyResult,
  SkipReason,
} from "./types";
import { supabaseAdmin } from "@/lib/supabase/admin";

const STORAGE_BUCKET = "notification-documents";

function snippet(s: string | undefined, n = 280): string | null {
  if (!s) return null;
  return s.length > n ? s.slice(0, n) : s;
}

function idempotencyKey(input: NotifyInput, channel: string, address: string): string {
  if (input.idempotencyKey) return `${input.idempotencyKey}:${channel}`;
  const e = input.entity;
  if (!e) return ""; // no entity → no idempotency (always send)
  return `${input.event}:${e.type}:${e.id}:${channel}:${address}`;
}

/** Resolve attachments (storagePath → base64 bytes) into provider-ready form. */
async function resolveAttachments(input: NotifyInput) {
  const out: Array<{ filename: string; content: string; contentType?: string }> = [];
  for (const att of input.attachments ?? []) {
    if (att.contentBase64) {
      out.push({ filename: att.filename, content: att.contentBase64, contentType: att.contentType });
      continue;
    }
    if (att.storagePath) {
      const { data, error } = await supabaseAdmin.storage
        .from(STORAGE_BUCKET)
        .download(att.storagePath);
      if (error || !data) {
        throw new Error(`attachment download failed (${att.storagePath}): ${error?.message}`);
      }
      const buf = Buffer.from(await data.arrayBuffer());
      out.push({
        filename: att.filename,
        content: buf.toString("base64"),
        contentType: att.contentType,
      });
    }
  }
  return out;
}

export async function notify(input: NotifyInput): Promise<NotifyResult> {
  const config = getConfig();
  const template = getTemplate(input.event);
  const results: NotifyChannelResult[] = [];

  // Resolve attachments once (shared across email channels). SMS ignores them.
  let resolvedAttachments: Array<{ filename: string; content: string; contentType?: string }> = [];
  const wantsEmail = input.channels.includes("email");
  if (wantsEmail && (input.attachments?.length ?? 0) > 0) {
    resolvedAttachments = await resolveAttachments(input);
  }
  const attachmentPath = input.attachments?.find((a) => a.storagePath)?.storagePath ?? null;

  for (const channel of input.channels) {
    const base = {
      event_type: input.event,
      channel,
      entity_type: input.entity?.type ?? null,
      entity_id: input.entity?.id ?? null,
      cc: null as string | null,
      subject: null as string | null,
      body_snippet: null as string | null,
      attachment_path: null as string | null,
      provider: null as string | null,
      provider_message_id: null as string | null,
      error: null as string | null,
      idempotency_key: null as string | null,
      sent_at: null as string | null,
    };

    // Helper to record + return a skip.
    const skip = async (
      to: string | null,
      reason: SkipReason,
    ): Promise<void> => {
      const logId = await writeLog({
        ...base,
        to_address: to ?? "(none)",
        status: "skipped",
        skip_reason: reason,
      } as LogRow);
      results.push({ channel, to, status: "skipped", skipReason: reason, logId: logId ?? undefined });
    };

    // ── Resolve address ──
    const address = channel === "email" ? input.to.email : input.to.phone;
    if (!address) {
      await skip(null, "no_address");
      continue;
    }

    // ── Opt-out (SMS) ──
    if (channel === "sms" && input.to.smsOptOut) {
      await skip(address, "opted_out");
      continue;
    }

    // ── Template renderer present? ──
    const hasRenderer = channel === "email" ? !!template.email : !!template.sms;
    if (!hasRenderer) {
      await skip(address, "no_template");
      continue;
    }

    // ── Idempotency ──
    const idem = idempotencyKey(input, channel, address);
    base.idempotency_key = idem || null;
    if (idem && (await alreadySent(idem))) {
      await skip(address, "duplicate");
      continue;
    }

    // ── Render ──
    let subject: string | null = null;
    let bodyForSnippet = "";
    try {
      if (channel === "email") {
        const r = template.email!(input.data, input.to);
        subject = r.subject;
        bodyForSnippet = r.text ?? r.html;
      } else {
        const r = template.sms!(input.data, input.to);
        bodyForSnippet = r.body;
      }
    } catch (e: any) {
      const logId = await writeLog({
        ...base,
        to_address: address,
        status: "failed",
        skip_reason: null,
        error: `template render error: ${e?.message ?? e}`,
      } as LogRow);
      results.push({ channel, to: address, status: "failed", error: String(e?.message ?? e), logId: logId ?? undefined });
      continue;
    }

    base.subject = subject;
    base.body_snippet = snippet(bodyForSnippet);

    // ── Kill-switch: log-only ──
    if (!config.enabled) {
      const logId = await writeLog({
        ...base,
        to_address: address,
        attachment_path: channel === "email" ? attachmentPath : null,
        status: "queued",
        skip_reason: "disabled",
      } as LogRow);
      results.push({ channel, to: address, status: "queued", skipReason: "disabled", logId: logId ?? undefined });
      continue;
    }

    // ── Send ──
    try {
      if (channel === "email") {
        const provider = getEmailProvider();
        const r = template.email!(input.data, input.to);
        const cc = config.ccEmail ? [...(input.cc ?? []), config.ccEmail] : input.cc;
        const outcome = await provider.send({
          to: address,
          from: config.fromEmail,
          cc,
          subject: r.subject,
          html: r.html,
          text: r.text,
          attachments: resolvedAttachments.length ? resolvedAttachments : undefined,
        });
        const logId = await writeLog({
          ...base,
          to_address: address,
          cc: cc?.join(", ") ?? null,
          attachment_path: attachmentPath,
          status: "sent",
          provider: provider.name,
          provider_message_id: outcome.providerMessageId,
          sent_at: new Date().toISOString(),
        } as LogRow);
        results.push({
          channel,
          to: address,
          status: "sent",
          provider: provider.name,
          providerMessageId: outcome.providerMessageId,
          logId: logId ?? undefined,
        });
      } else {
        const provider = getSmsProvider();
        if (!config.smsFrom && !provider.isMock) {
          throw new Error("TWILIO_FROM_NUMBER is not configured");
        }
        const r = template.sms!(input.data, input.to);
        const outcome = await provider.send({
          to: address,
          from: config.smsFrom ?? "+10000000000",
          body: r.body,
        });
        const logId = await writeLog({
          ...base,
          to_address: address,
          status: "sent",
          provider: provider.name,
          provider_message_id: outcome.providerMessageId,
          sent_at: new Date().toISOString(),
        } as LogRow);
        results.push({
          channel,
          to: address,
          status: "sent",
          provider: provider.name,
          providerMessageId: outcome.providerMessageId,
          logId: logId ?? undefined,
        });
      }
    } catch (e: any) {
      const logId = await writeLog({
        ...base,
        to_address: address,
        attachment_path: channel === "email" ? attachmentPath : null,
        status: "failed",
        error: String(e?.message ?? e),
      } as LogRow);
      results.push({ channel, to: address, status: "failed", error: String(e?.message ?? e), logId: logId ?? undefined });
    }
  }

  return { results };
}
