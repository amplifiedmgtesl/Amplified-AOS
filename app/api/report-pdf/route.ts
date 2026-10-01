/**
 * app/api/report-pdf/route.ts — SPIKE (report-email plan step 0)
 *
 * POST /api/report-pdf  { reportType: "pre_invoice", id, noShows? }
 *   Bearer <access token>. Renders the report's print page on this same
 *   deployment with headless Chrome and returns the PDF. Timings come back
 *   in X-Render-* headers so the spike can judge cold-start cost.
 *
 * GET /api/report-pdf?selftest=1  (never on production)
 *   Renders a tiny static page — proves Chrome launches on Vercel without
 *   needing a login or touching any data.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { renderPdf } from "@/lib/pdf/render-pdf";
import { reportFileName } from "@/lib/print-with-title";

export const runtime = "nodejs";
export const maxDuration = 60;

// Same roles the Pre-Invoice view blocks (pre-invoice-report-view.tsx).
const PRICING_BLOCKED_ROLES = new Set(["crew_leader", "payroll", "coordinator"]);

function isValidTimeZone(tz: unknown): tz is string {
  if (typeof tz !== "string" || !tz) return false;
  try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return true; } catch { return false; }
}

// Module-scope flag: true only on the first request a function instance serves.
let warm = false;

function pdfResponse(pdf: Uint8Array, filename: string, timings: Record<string, number>, cold: boolean) {
  return new NextResponse(Buffer.from(pdf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      // ASCII fallback + UTF-8 name (the " — " separator isn't ASCII).
      "Content-Disposition": `inline; filename="${filename.replace(/[^\x20-\x7e]/g, "-")}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Cache-Control": "no-store",
      "X-Render-Cold": String(cold),
      "X-Render-Launch-Ms": String(timings.launchMs),
      "X-Render-Load-Ms": String(timings.loadMs),
      "X-Render-Pdf-Ms": String(timings.pdfMs),
      "X-Render-Total-Ms": String(timings.totalMs),
      "X-Render-Bytes": String(pdf.byteLength),
    },
  });
}

export async function GET(req: NextRequest) {
  const mode = req.nextUrl.searchParams.get("selftest");
  if (process.env.VERCEL_ENV === "production" || (mode !== "1" && mode !== "page")) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const cold = !warm; warm = true;
  if (mode === "page") {
    // Loads a real (login) page on this deployment — proves the Vercel
    // protection bypass works for headless Chrome. No session, no data.
    try {
      const { pdf, timings } = await renderPdf({
        url: new URL("/login", req.nextUrl.origin).toString(),
        waitForReady: false,
      });
      const res = pdfResponse(pdf, "selftest-page.pdf", timings, cold);
      res.headers.set("X-Bypass-Secret-Set", String(!!process.env.VERCEL_AUTOMATION_BYPASS_SECRET));
      return res;
    } catch (e: any) {
      return NextResponse.json({ error: String(e?.message ?? e), bypassSecretSet: !!process.env.VERCEL_AUTOMATION_BYPASS_SECRET }, { status: 500 });
    }
  }
  try {
    const { pdf, timings } = await renderPdf({
      url: "about:blank",
      html: `<!doctype html><html><body style="font-family:Arial,sans-serif;padding:40px">
        <h1>AOS server PDF self-test</h1>
        <p>Rendered ${new Date().toISOString()} on ${process.env.VERCEL_ENV ?? "local"}.</p>
        <p style="font-family:Arial">Arial: The quick brown fox jumps over the lazy dog 0123456789</p>
        <p style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif">System stack (Pre-Invoice): The quick brown fox 0123456789</p>
        <p style="font-family:Georgia,serif;font-style:italic;font-weight:700">Georgia bold italic: The quick brown fox</p>
        <p style="font-family:'Arial Black',Impact,Arial,sans-serif;font-style:italic;text-transform:uppercase">Arial Black italic: Pre-Invoice Summary</p>
        <p style="font-family:'Open Sans'">Open Sans (old fallback): The quick brown fox 0123456789</p></body></html>`,
    });
    return pdfResponse(pdf, "selftest.pdf", timings, cold);
  } catch (e: any) {
    console.error("[report-pdf selftest]", e);
    return NextResponse.json({ error: String(e?.message ?? e) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const cold = !warm; warm = true;

  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(token);
  if (authErr || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { reportType?: string; id?: string; noShows?: boolean; timeZone?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (body.reportType !== "pre_invoice" || !body.id) {
    return NextResponse.json({ error: "Only reportType 'pre_invoice' with an id is supported in the spike." }, { status: 400 });
  }

  const { data: profile } = await supabaseAdmin.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (!profile?.role || PRICING_BLOCKED_ROLES.has(profile.role)) {
    return NextResponse.json({ error: "Not available for your role" }, { status: 403 });
  }

  const url = new URL(`/job-requests/${encodeURIComponent(body.id)}/pre-invoice-report`, req.nextUrl.origin);
  if (body.noShows) url.searchParams.set("noshows", "1");

  try {
    const timeZone = isValidTimeZone(body.timeZone) ? body.timeZone : "America/New_York";
    const { pdf, timings } = await renderPdf({ url: url.toString(), accessToken: token, timeZone });
    const { data: job } = await supabaseAdmin.from("job_requests").select("job_no").eq("id", body.id).maybeSingle();
    const today = new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date()); // YYYY-MM-DD
    const filename = `${reportFileName([job?.job_no || body.id, "Pre-Invoice Summary", today])}.pdf`;
    return pdfResponse(pdf, filename, timings, cold);
  } catch (e: any) {
    console.error("[report-pdf]", e);
    return NextResponse.json({ error: String(e?.message ?? e) }, { status: 500 });
  }
}
