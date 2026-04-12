/**
 * seed-from-export.mjs
 *
 * Loads a local export.json into the Supabase dedicated tables.
 * Run from the project root:
 *   node scripts/seed-from-export.mjs [path/to/export.json]
 */

import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import { config } from "dotenv";

config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const exportPath = process.argv[2] || "./export.json";
const raw = JSON.parse(fs.readFileSync(exportPath, "utf8"));

console.log(`Loading from ${exportPath}...`);

// ── Helpers ────────────────────────────────────────────────────────────────

async function upsert(table, rows) {
  if (!rows.length) { console.log(`  ${table}: skipped (empty)`); return; }
  const { error } = await supabase.from(table).upsert(rows);
  if (error) throw new Error(`${table}: ${error.message}`);
  console.log(`  ${table}: ${rows.length} rows`);
}

// ── Calendar events ────────────────────────────────────────────────────────

const events = raw["aes_manual_events_v2"] ?? [];
const deletedIds = new Set(raw["aes_deleted_event_ids_v1"] ?? []);
const profiles = raw["aes_event_profiles_v1"] ?? {};

await upsert("calendar_events", events.map((e) => ({
  id: e.id,
  source: e.source ?? "",
  client: e.client ?? "",
  event_name: e.eventName ?? "",
  venue: e.venue ?? "",
  venue_address: e.venueAddress ?? null,
  city: e.city ?? null,
  state: e.state ?? null,
  city_state: e.cityState ?? "",
  google_maps_link: e.googleMapsLink ?? null,
  start_date: e.startDate ?? "",
  end_date: e.endDate ?? "",
  start_time: e.startTime ?? "",
  end_time: e.endTime ?? "",
  notes: e.notes ?? "",
  status: e.status ?? "",
  lead: e.lead ?? null,
  hands: e.hands ?? null,
  is_deleted: deletedIds.has(e.id),
  profile_notes: profiles[e.id]?.notes ?? null,
  profile_attachment_names: profiles[e.id]?.attachmentNames ?? [],
})));

// ── Quotes ────────────────────────────────────────────────────────────────

await upsert("quotes", (raw["aes_quotes_v2"] ?? []).map((q) => ({
  id: q.id,
  client: q.client ?? "",
  event_name: q.eventName ?? "",
  venue: q.venue ?? "",
  city_state: q.cityState ?? "",
  start_date: q.startDate ?? "",
  end_date: q.endDate ?? "",
  start_time: q.startTime ?? "",
  end_time: q.endTime ?? "",
  expected_hours_per_day: q.expectedHoursPerDay ?? null,
  total: q.total ?? 0,
  deposit: q.deposit ?? 0,
  status: q.status ?? "draft",
  notes: q.notes ?? "",
  lines: q.lines ?? [],
  terms: q.terms ?? "",
  linked_job_request_id: q.linkedJobRequestId ?? null,
  linked_job_sheet_id: q.linkedJobSheetId ?? null,
  timesheet_summary: q.timesheetSummary ?? null,
  signature_name: q.signatureName ?? null,
  signed_at: q.signedAt ?? null,
  rate_card_profile_id: q.rateCardProfileId ?? null,
})));

// ── Quote draft workspaces ────────────────────────────────────────────────

await upsert("quote_draft_workspaces", (raw["aes_quote_drafts_v1"] ?? []).map((w) => ({
  id: w.id,
  name: w.name ?? "",
  updated_at: w.updatedAt ?? new Date().toISOString(),
  data: w.data ?? {},
})));

// ── Invoices ──────────────────────────────────────────────────────────────

await upsert("invoices", (raw["aes_invoice_drafts_v2"] ?? []).map((inv) => ({
  id: inv.id,
  quote_id: inv.quoteId ?? "",
  invoice_no: inv.invoiceNo ?? "",
  issue_date: inv.issueDate ?? "",
  due_date: inv.dueDate ?? "",
  po_no: inv.poNo ?? "",
  bill_to: inv.billTo ?? "",
  client: inv.client ?? "",
  event_name: inv.eventName ?? "",
  venue: inv.venue ?? "",
  city_state: inv.cityState ?? "",
  lines: inv.lines ?? [],
  subtotal: inv.subtotal ?? 0,
  deposit: inv.deposit ?? 0,
  amount_due: inv.amountDue ?? 0,
  terms: inv.terms ?? "",
  notes: inv.notes ?? "",
  status: inv.status ?? "",
  paid_amount: inv.paidAmount ?? 0,
  rate_card_profile_id: inv.rateCardProfileId ?? null,
  linked_job_sheet_id: inv.linkedJobSheetId ?? null,
  timesheet_summary: inv.timesheetSummary ?? null,
})));

// ── Job requests ──────────────────────────────────────────────────────────

await upsert("job_requests", (raw["aes_job_requests_v2"] ?? []).map((j) => ({
  id: j.id,
  client: j.client ?? "",
  event_name: j.eventName ?? "",
  venue: j.venue ?? "",
  venue_address: j.venueAddress ?? "",
  city: j.city ?? "",
  state: j.state ?? "",
  city_state: j.cityState ?? "",
  google_maps_link: j.googleMapsLink ?? "",
  request_date: j.requestDate ?? "",
  end_date: j.endDate ?? null,
  start_time: j.startTime ?? "",
  end_time: j.endTime ?? "",
  expected_hours: j.expectedHours ?? null,
  add_to_calendar: j.addToCalendar ?? null,
  status: j.status ?? "",
  notes: j.notes ?? "",
  attachment_names: j.attachmentNames ?? [],
  packet_notes: j.packetNotes ?? "",
})));

// ── Job sheets ────────────────────────────────────────────────────────────

await upsert("job_sheets", (raw["aes_job_sheets_v2"] ?? []).map((j) => ({
  id: j.id,
  source_event_id: j.sourceEventId ?? null,
  title: j.title ?? "",
  client: j.client ?? "",
  event_name: j.eventName ?? "",
  venue: j.venue ?? "",
  venue_address: j.venueAddress ?? null,
  city: j.city ?? null,
  state: j.state ?? null,
  city_state: j.cityState ?? "",
  google_maps_link: j.googleMapsLink ?? null,
  date: j.date ?? "",
  call_time: j.callTime ?? "",
  notes: j.notes ?? "",
  attachment_names: j.attachmentNames ?? [],
  workers: j.workers ?? [],
})));

// ── Timesheets ────────────────────────────────────────────────────────────

await upsert("timesheets", (raw["aes_timesheets_v1"] ?? []).map((t) => ({
  id: t.id,
  job_sheet_id: t.jobSheetId ?? "",
  title: t.title ?? "",
  hide_pay_columns: t.hidePayColumns ?? false,
  rows: t.rows ?? [],
})));

// ── Job costing ───────────────────────────────────────────────────────────

await upsert("job_costing_drafts", (raw["aes_job_costing_drafts_v1"] ?? []).map((j) => ({
  id: j.id,
  title: j.title ?? "",
  client: j.client ?? "",
  event_name: j.eventName ?? "",
  venue: j.venue ?? "",
  city_state: j.cityState ?? "",
  linked_job_request_id: j.linkedJobRequestId ?? null,
  linked_quote_id: j.linkedQuoteId ?? null,
  linked_job_sheet_id: j.linkedJobSheetId ?? null,
  linked_timesheet_id: j.linkedTimesheetId ?? null,
  linked_rate_card_profile_id: j.linkedRateCardProfileId ?? null,
  payroll_burden: j.payrollBurden ?? 0.15,
  overhead_per_hour: j.overheadPerHour ?? 3,
  target_margin: j.targetMargin ?? 0.25,
  ot_pay_multiplier: j.otPayMultiplier ?? 1.5,
  dt_pay_multiplier: j.dtPayMultiplier ?? 2.0,
  ot_bill_multiplier: j.otBillMultiplier ?? 1.5,
  dt_bill_multiplier: j.dtBillMultiplier ?? 2.0,
  minimum_hours: j.minimumHours ?? 5,
  billed_expenses: j.billedExpenses ?? 0,
  rentals: j.rentals ?? 0,
  pass_through_markup_revenue: j.passThroughMarkupRevenue ?? 0,
  actual_travel: j.actualTravel ?? 0,
  actual_hotels: j.actualHotels ?? 0,
  actual_per_diem: j.actualPerDiem ?? 0,
  actual_equipment: j.actualEquipment ?? 0,
  actual_other_costs: j.actualOtherCosts ?? 0,
  actual_revenue_collected: j.actualRevenueCollected ?? 0,
  estimated_job_cost: j.estimatedJobCost ?? 0,
  lines: j.lines ?? [],
  created_at: j.createdAt ?? new Date().toISOString(),
  updated_at: j.updatedAt ?? new Date().toISOString(),
})));

// ── Rate card profiles ────────────────────────────────────────────────────

await upsert("rate_card_profiles", (raw["amplified_rate_profiles_v1"] ?? []).map((p) => ({
  id: p.id,
  client_name: p.clientName ?? "",
  rows: p.rows ?? [],
  terms: p.terms ?? "",
  created_at: p.createdAt ?? new Date().toISOString(),
  updated_at: p.updatedAt ?? new Date().toISOString(),
})));

// ── Rate state (rows, terms, client name) ─────────────────────────────────

const rateState = [];
if (raw["amplified_rate_rows_v9"]) rateState.push({ key: "rate_rows", value: raw["amplified_rate_rows_v9"] });
if (raw["amplified_rate_terms_v9"]) rateState.push({ key: "terms", value: raw["amplified_rate_terms_v9"] });
if (raw["amplified_rate_client_v9"]) rateState.push({ key: "client_name", value: raw["amplified_rate_client_v9"] });
await upsert("app_rate_state", rateState);

console.log("\nDone.");
