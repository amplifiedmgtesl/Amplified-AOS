"use client";

/**
 * components/shared/notification-test.tsx
 *
 * IT-only test surface for the notifications module. Lets you fire any event
 * on any channel and see the full result (provider used, message id, log id,
 * skip reasons). With no API keys configured the providers are MOCK — you can
 * exercise the entire pipeline safely. Once Resend/Twilio keys are set, the
 * same form sends for real (point it at your own inbox/phone first).
 *
 * Reached at /notification-test. Gated to the IT user; the real guard is the
 * IT-only check on /api/notifications.
 */

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { useUserEmail } from "@/lib/auth/use-user-email";
import {
  EVENT_LABELS,
  type NotificationChannel,
  type NotificationEvent,
  type NotifyResult,
} from "@/lib/notifications/types";

const IT_EMAIL = "jobrien@synergypro.com";

// Sensible default `data` per event, so the form is ready to fire.
const SAMPLE_DATA: Record<NotificationEvent, Record<string, unknown>> = {
  crew_assigned: {
    crewName: "Casey Crew",
    jobName: "Ohio Country Fest",
    eventDate: "2026-07-04",
    venue: "Columbus, OH",
    confirmUrl: "https://example.com/confirm/abc",
  },
  quote_issued: {
    docNumber: "LNC-event-00042",
    clientName: "Loud & Clear",
    total: "$12,500.00",
    viewUrl: "https://example.com/quotes/42",
  },
  invoice_issued: {
    docNumber: "INV-00128",
    clientName: "Loud & Clear",
    total: "$9,800.00",
    dueDate: "2026-07-15",
  },
  internal_alert: {
    title: "Roster import failed",
    message: "3 of 18 rows had unmatched employees.",
    link: "https://example.com/jobs/123",
  },
};

async function token(): Promise<string | null> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

type Status = {
  providers: { email: { provider: string; isMock: boolean }; sms: { provider: string; isMock: boolean } };
  enabled: boolean;
  fromEmail: string;
  ccEmail: string | null;
  smsConfigured: boolean;
};

export function NotificationTest() {
  const userEmail = useUserEmail();
  const isIT = userEmail === IT_EMAIL;

  const [status, setStatus] = useState<Status | null>(null);
  const [event, setEvent] = useState<NotificationEvent>("internal_alert");
  const [channels, setChannels] = useState<NotificationChannel[]>(["email"]);
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [dataJson, setDataJson] = useState(JSON.stringify(SAMPLE_DATA.internal_alert, null, 2));
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<NotifyResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    const res = await fetch("/api/notifications", {
      headers: { Authorization: `Bearer ${await token()}` },
    });
    if (res.ok) setStatus(await res.json());
  }, []);

  useEffect(() => {
    if (isIT) loadStatus();
  }, [isIT, loadStatus]);

  const onEventChange = (e: NotificationEvent) => {
    setEvent(e);
    setDataJson(JSON.stringify(SAMPLE_DATA[e], null, 2));
  };

  const toggleChannel = (c: NotificationChannel) => {
    setChannels((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]));
  };

  const send = async () => {
    setError(null);
    setResult(null);
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(dataJson);
    } catch {
      setError("Data is not valid JSON.");
      return;
    }
    setSending(true);
    try {
      const res = await fetch("/api/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${await token()}` },
        body: JSON.stringify({
          event,
          channels,
          to: { email: email || null, phone: phone || null, name: name || null },
          data,
          entity: { type: "test", id: `manual-${Date.now()}` },
        }),
      });
      const json = await res.json();
      if (!res.ok) setError(json.error || `HTTP ${res.status}`);
      else setResult(json);
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setSending(false);
    }
  };

  if (userEmail === null) return <div style={{ padding: 24 }}>Loading…</div>;
  if (!isIT) return <div style={{ padding: 24 }}>This page is restricted to IT.</div>;

  const liveBadge = (isMock: boolean) =>
    isMock ? (
      <span style={{ color: "#92400e", background: "#fef3c7", padding: "2px 8px", borderRadius: 4, fontSize: 12 }}>MOCK</span>
    ) : (
      <span style={{ color: "#065f46", background: "#d1fae5", padding: "2px 8px", borderRadius: 4, fontSize: 12 }}>LIVE</span>
    );

  return (
    <div style={{ padding: 24, maxWidth: 760 }}>
      <h1 style={{ fontSize: 22, fontWeight: 600 }}>Notifications — Test Surface</h1>
      <p style={{ color: "#555", fontSize: 14 }}>
        IT-only. Fire any event on any channel and inspect the result. Providers fall back to MOCK
        until keys are configured — MOCK logs to the server and writes a notification_log row, but
        sends nothing.
      </p>

      {status && (
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", margin: "12px 0 20px", fontSize: 14 }}>
          <div>Email: {liveBadge(status.providers.email.isMock)} <code>{status.providers.email.provider}</code></div>
          <div>SMS: {liveBadge(status.providers.sms.isMock)} <code>{status.providers.sms.provider}</code></div>
          <div>Sending: {status.enabled ? "enabled" : "DISABLED (log-only)"}</div>
          <div>From: <code>{status.fromEmail}</code></div>
          <div>CC: <code>{status.ccEmail ?? "(none)"}</code></div>
        </div>
      )}

      <label style={{ display: "block", marginBottom: 12 }}>
        Event
        <select
          value={event}
          onChange={(e) => onEventChange(e.target.value as NotificationEvent)}
          style={{ display: "block", marginTop: 4, padding: 6, minWidth: 320 }}
        >
          {(Object.keys(EVENT_LABELS) as NotificationEvent[]).map((e) => (
            <option key={e} value={e}>{EVENT_LABELS[e]} ({e})</option>
          ))}
        </select>
      </label>

      <div style={{ marginBottom: 12 }}>
        Channels:
        {(["email", "sms"] as NotificationChannel[]).map((c) => (
          <label key={c} style={{ marginLeft: 12 }}>
            <input type="checkbox" checked={channels.includes(c)} onChange={() => toggleChannel(c)} /> {c}
          </label>
        ))}
      </div>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
        <label>To email<input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" style={{ display: "block", padding: 6, minWidth: 240 }} /></label>
        <label>To phone (E.164)<input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+16145551234" style={{ display: "block", padding: 6, minWidth: 200 }} /></label>
        <label>Name<input value={name} onChange={(e) => setName(e.target.value)} style={{ display: "block", padding: 6, minWidth: 160 }} /></label>
      </div>

      <label style={{ display: "block", marginBottom: 12 }}>
        Template data (JSON)
        <textarea value={dataJson} onChange={(e) => setDataJson(e.target.value)} rows={8} style={{ display: "block", width: "100%", fontFamily: "monospace", fontSize: 13, padding: 8, marginTop: 4 }} />
      </label>

      <button onClick={send} disabled={sending || channels.length === 0} style={{ padding: "8px 18px", fontSize: 14, fontWeight: 600 }}>
        {sending ? "Sending…" : "Send test notification"}
      </button>

      {error && <p style={{ color: "#b91c1c", marginTop: 16 }}>{error}</p>}

      {result && (
        <div style={{ marginTop: 20 }}>
          <h2 style={{ fontSize: 16, fontWeight: 600 }}>Result</h2>
          <table style={{ borderCollapse: "collapse", fontSize: 13, marginTop: 8 }}>
            <thead>
              <tr>{["channel", "status", "to", "provider", "message id / reason"].map((h) => (
                <th key={h} style={{ textAlign: "left", borderBottom: "1px solid #ccc", padding: "4px 10px" }}>{h}</th>
              ))}</tr>
            </thead>
            <tbody>
              {result.results.map((r, i) => (
                <tr key={i}>
                  <td style={{ padding: "4px 10px" }}>{r.channel}</td>
                  <td style={{ padding: "4px 10px" }}>{r.status}</td>
                  <td style={{ padding: "4px 10px" }}>{r.to ?? "—"}</td>
                  <td style={{ padding: "4px 10px" }}>{r.provider ?? "—"}</td>
                  <td style={{ padding: "4px 10px" }}>{r.providerMessageId ?? r.skipReason ?? r.error ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
