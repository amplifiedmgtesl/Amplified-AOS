/**
 * lib/pdf/render-pdf.ts
 *
 * Server-only. Turns one of AOS's existing print pages into a PDF with
 * headless Chrome, so the emailed/downloaded PDF is the same layout as Print
 * (docs/report-email-plan.md §3a).
 *
 * How it sees the page as the sender: report pages load their data in the
 * browser with the user's Supabase session (localStorage). We plant the
 * sender's ACCESS token in localStorage before any app script runs. The
 * refresh token is deliberately NOT passed — Supabase rotates refresh tokens
 * on use, so a headless refresh would log the real user out. The caller sends
 * a fresh access token (the browser's getSession() refreshes it first), which
 * is good for the minute this render takes.
 *
 * Preview deployments sit behind Vercel's login wall; the first navigation
 * carries the automation-bypass secret so Vercel sets a bypass cookie.
 */

import chromium from "@sparticuz/chromium";
import puppeteer, { type Browser } from "puppeteer-core";

export interface RenderPdfInput {
  /** Absolute URL of the print page on THIS deployment. */
  url: string;
  /** Sender's Supabase access token (JWT). Omit for pages that need no login. */
  accessToken?: string;
  /** Raw HTML to render instead of a URL (self-test only). */
  html?: string;
  /** Max wait for the page's data-report-ready marker. */
  timeoutMs?: number;
}

export interface RenderPdfResult {
  pdf: Uint8Array;
  timings: { launchMs: number; loadMs: number; pdfMs: number; totalMs: number };
}

const READY_SELECTOR = "[data-report-ready], [data-report-error]";

function storageKeyFor(supabaseUrl: string): string {
  // supabase-js default: sb-<project ref>-auth-token
  return `sb-${new URL(supabaseUrl).hostname.split(".")[0]}-auth-token`;
}

/** Minimal session object supabase-js accepts from storage. */
function sessionFromAccessToken(accessToken: string) {
  const payload = JSON.parse(Buffer.from(accessToken.split(".")[1], "base64url").toString("utf8"));
  const now = Math.floor(Date.now() / 1000);
  return {
    access_token: accessToken,
    token_type: "bearer",
    expires_at: payload.exp,
    expires_in: Math.max(0, payload.exp - now),
    // Placeholder — see header comment. A refresh attempt fails rather than
    // rotating the user's real refresh token.
    refresh_token: "server-render-no-refresh",
    user: { id: payload.sub, email: payload.email, role: payload.role, aud: payload.aud },
  };
}

async function launch(): Promise<Browser> {
  const localChrome = process.env.LOCAL_CHROME_PATH;
  if (localChrome) {
    return puppeteer.launch({ executablePath: localChrome, headless: true });
  }
  return puppeteer.launch({
    args: chromium.args,
    executablePath: await chromium.executablePath(),
    headless: true,
    defaultViewport: { width: 1200, height: 1600 },
  });
}

export async function renderPdf(input: RenderPdfInput): Promise<RenderPdfResult> {
  const t0 = Date.now();
  const browser = await launch();
  const tLaunch = Date.now();
  try {
    const page = await browser.newPage();

    if (input.accessToken) {
      const key = storageKeyFor(process.env.NEXT_PUBLIC_SUPABASE_URL!);
      const value = JSON.stringify(sessionFromAccessToken(input.accessToken));
      await page.evaluateOnNewDocument(
        (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
        key, value,
      );
    }

    await page.emulateMediaType("print");

    if (input.html) {
      await page.setContent(input.html, { waitUntil: "load" });
    } else {
      const target = new URL(input.url);
      const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
      if (bypass) {
        target.searchParams.set("x-vercel-protection-bypass", bypass);
        target.searchParams.set("x-vercel-set-bypass-cookie", "true");
      }
      await page.goto(target.toString(), { waitUntil: "domcontentloaded", timeout: input.timeoutMs ?? 30000 });
      const marker = await page.waitForSelector(READY_SELECTOR, { timeout: input.timeoutMs ?? 30000 });
      const err = await marker?.evaluate((el) => el.getAttribute("data-report-error"));
      if (err) throw new Error(`Report page reported an error: ${err}`);
      // Logo + fonts finish after the data marker.
      await page.evaluate(async () => {
        await document.fonts.ready;
        await Promise.all(Array.from(document.images).map((img) =>
          img.complete ? null : new Promise((r) => { img.onload = img.onerror = r; })));
      });
    }
    const tLoad = Date.now();

    const pdf = await page.pdf({ printBackground: true, preferCSSPageSize: true });
    const tPdf = Date.now();
    return {
      pdf,
      timings: { launchMs: tLaunch - t0, loadMs: tLoad - tLaunch, pdfMs: tPdf - tLoad, totalMs: tPdf - t0 },
    };
  } finally {
    await browser.close();
  }
}
