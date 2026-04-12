/**
 * lib/store/export-data.ts
 *
 * One-time data export helper for migrating existing localStorage data to Supabase.
 *
 * HOW TO USE:
 * 1. Open your EXISTING (localStorage) app in a browser.
 * 2. Open DevTools → Console.
 * 3. Paste and run the function below to export all data as JSON.
 * 4. Copy the output and save it as export.json.
 * 5. Run the seed script (see bottom of this file) against your Supabase project.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * STEP 1: Run this in the browser console of the OLD (localStorage) app
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   (function exportAOS() {
 *     const keys = [
 *       'aes_manual_events_v2',
 *       'aes_deleted_event_ids_v1',
 *       'aes_event_profiles_v1',
 *       'aes_quotes_v2',
 *       'aes_quote_drafts_v1',
 *       'aes_invoice_drafts_v2',
 *       'aes_job_requests_v2',
 *       'aes_job_sheets_v2',
 *       'aes_timesheets_v1',
 *       'aes_employees_v1',
 *       'aes_job_costing_drafts_v1',
 *       'amplified_rate_rows_v9',
 *       'amplified_rate_terms_v9',
 *       'amplified_rate_client_v9',
 *       'amplified_rate_profiles_v1',
 *     ];
 *     const out = {};
 *     for (const k of keys) {
 *       const v = localStorage.getItem(k);
 *       if (v) out[k] = JSON.parse(v);
 *     }
 *     console.log(JSON.stringify(out, null, 2));
 *   })();
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * STEP 2: Run this seed script (Node.js) once to load the export into Supabase
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   // seed.mjs  — run with: node seed.mjs
 *   import { createClient } from '@supabase/supabase-js';
 *   import fs from 'fs';
 *
 *   const SUPABASE_URL   = 'https://your-project.supabase.co';
 *   const SUPABASE_KEY   = 'your-service-role-key'; // Use SERVICE ROLE key for seeding
 *   const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
 *
 *   const raw = JSON.parse(fs.readFileSync('./export.json', 'utf8'));
 *
 *   async function seed() {
 *     // Calendar events
 *     const events = raw['aes_manual_events_v2'] ?? [];
 *     const deletedIds = new Set(raw['aes_deleted_event_ids_v1'] ?? []);
 *     const profiles = raw['aes_event_profiles_v1'] ?? {};
 *     for (const e of events) {
 *       const profile = profiles[e.id];
 *       await supabase.from('calendar_events').upsert({
 *         id: e.id, source: e.source, client: e.client,
 *         event_name: e.eventName, venue: e.venue,
 *         venue_address: e.venueAddress ?? null, city: e.city ?? null,
 *         state: e.state ?? null, city_state: e.cityState,
 *         google_maps_link: e.googleMapsLink ?? null,
 *         start_date: e.startDate, end_date: e.endDate,
 *         start_time: e.startTime, end_time: e.endTime,
 *         notes: e.notes, status: e.status,
 *         lead: e.lead ?? null, hands: e.hands ?? null,
 *         is_deleted: deletedIds.has(e.id),
 *         profile_notes: profile?.notes ?? null,
 *         profile_attachment_names: profile?.attachmentNames ?? [],
 *       });
 *     }
 *
 *     // Quotes
 *     for (const q of raw['aes_quotes_v2'] ?? []) {
 *       await supabase.from('quotes').upsert({
 *         id: q.id, client: q.client, event_name: q.eventName,
 *         venue: q.venue, city_state: q.cityState,
 *         start_date: q.startDate, end_date: q.endDate,
 *         start_time: q.startTime, end_time: q.endTime,
 *         expected_hours_per_day: q.expectedHoursPerDay ?? null,
 *         total: q.total, deposit: q.deposit, status: q.status,
 *         notes: q.notes, lines: q.lines, terms: q.terms,
 *         linked_job_request_id: q.linkedJobRequestId ?? null,
 *         linked_job_sheet_id: q.linkedJobSheetId ?? null,
 *         timesheet_summary: q.timesheetSummary ?? null,
 *         signature_name: q.signatureName ?? null,
 *         signed_at: q.signedAt ?? null,
 *         rate_card_profile_id: q.rateCardProfileId ?? null,
 *       });
 *     }
 *
 *     // Quote draft workspaces
 *     for (const w of raw['aes_quote_drafts_v1'] ?? []) {
 *       await supabase.from('quote_draft_workspaces').upsert({
 *         id: w.id, name: w.name, updated_at: w.updatedAt, data: w.data,
 *       });
 *     }
 *
 *     // Invoices
 *     for (const inv of raw['aes_invoice_drafts_v2'] ?? []) {
 *       await supabase.from('invoices').upsert({
 *         id: inv.id, quote_id: inv.quoteId, invoice_no: inv.invoiceNo,
 *         issue_date: inv.issueDate, due_date: inv.dueDate,
 *         po_no: inv.poNo, bill_to: inv.billTo, client: inv.client,
 *         event_name: inv.eventName, venue: inv.venue, city_state: inv.cityState,
 *         lines: inv.lines, subtotal: inv.subtotal, deposit: inv.deposit,
 *         amount_due: inv.amountDue, terms: inv.terms, notes: inv.notes,
 *         status: inv.status, paid_amount: inv.paidAmount,
 *         rate_card_profile_id: inv.rateCardProfileId ?? null,
 *         linked_job_sheet_id: inv.linkedJobSheetId ?? null,
 *         timesheet_summary: inv.timesheetSummary ?? null,
 *       });
 *     }
 *
 *     // Job requests
 *     for (const j of raw['aes_job_requests_v2'] ?? []) {
 *       await supabase.from('job_requests').upsert({
 *         id: j.id, client: j.client, event_name: j.eventName,
 *         venue: j.venue, venue_address: j.venueAddress,
 *         city: j.city, state: j.state, city_state: j.cityState,
 *         google_maps_link: j.googleMapsLink, request_date: j.requestDate,
 *         end_date: j.endDate ?? null, start_time: j.startTime, end_time: j.endTime,
 *         expected_hours: j.expectedHours ?? null,
 *         add_to_calendar: j.addToCalendar ?? null,
 *         status: j.status, notes: j.notes,
 *         attachment_names: j.attachmentNames, packet_notes: j.packetNotes,
 *       });
 *     }
 *
 *     // Job sheets
 *     for (const j of raw['aes_job_sheets_v2'] ?? []) {
 *       await supabase.from('job_sheets').upsert({
 *         id: j.id, source_event_id: j.sourceEventId ?? null,
 *         title: j.title, client: j.client, event_name: j.eventName,
 *         venue: j.venue, venue_address: j.venueAddress ?? null,
 *         city: j.city ?? null, state: j.state ?? null, city_state: j.cityState,
 *         google_maps_link: j.googleMapsLink ?? null,
 *         date: j.date, call_time: j.callTime, notes: j.notes,
 *         attachment_names: j.attachmentNames, workers: j.workers,
 *       });
 *     }
 *
 *     // Timesheets
 *     for (const t of raw['aes_timesheets_v1'] ?? []) {
 *       await supabase.from('timesheets').upsert({
 *         id: t.id, job_sheet_id: t.jobSheetId, title: t.title,
 *         hide_pay_columns: t.hidePayColumns, rows: t.rows,
 *       });
 *     }
 *
 *     // Employees
 *     for (const e of raw['aes_employees_v1'] ?? []) {
 *       await supabase.from('employees').upsert({
 *         employee_key: e.employeeKey, employee_id: e.employeeId ?? null,
 *         full_name: e.fullName, first_name: e.firstName ?? null,
 *         last_name: e.lastName ?? null, payroll_name: e.payrollName ?? null,
 *         preferred_name: e.preferredName ?? null, status: e.status ?? null,
 *         worker_category: e.workerCategory ?? null,
 *         position_status: e.positionStatus ?? null,
 *         employment_type: e.employmentType ?? null,
 *         city: e.city ?? null, state: e.state ?? null,
 *         state_code: e.stateCode ?? null, email: e.email ?? null,
 *         phone: e.phone ?? null, address: e.address ?? null,
 *         notes: e.notes ?? null, profile_picture: e.profilePicture ?? null,
 *         documents: e.documents ?? [], source: e.source ?? null,
 *         is_deleted: false,
 *       });
 *     }
 *
 *     // Job costing
 *     for (const j of raw['aes_job_costing_drafts_v1'] ?? []) {
 *       await supabase.from('job_costing_drafts').upsert({
 *         id: j.id, title: j.title, client: j.client,
 *         event_name: j.eventName, venue: j.venue, city_state: j.cityState,
 *         linked_job_request_id: j.linkedJobRequestId ?? null,
 *         linked_quote_id: j.linkedQuoteId ?? null,
 *         linked_job_sheet_id: j.linkedJobSheetId ?? null,
 *         linked_timesheet_id: j.linkedTimesheetId ?? null,
 *         linked_rate_card_profile_id: j.linkedRateCardProfileId ?? null,
 *         payroll_burden: j.payrollBurden, overhead_per_hour: j.overheadPerHour,
 *         target_margin: j.targetMargin, ot_pay_multiplier: j.otPayMultiplier,
 *         dt_pay_multiplier: j.dtPayMultiplier, ot_bill_multiplier: j.otBillMultiplier,
 *         dt_bill_multiplier: j.dtBillMultiplier, minimum_hours: j.minimumHours,
 *         billed_expenses: j.billedExpenses, rentals: j.rentals,
 *         pass_through_markup_revenue: j.passThroughMarkupRevenue,
 *         actual_travel: j.actualTravel, actual_hotels: j.actualHotels,
 *         actual_per_diem: j.actualPerDiem, actual_equipment: j.actualEquipment,
 *         actual_other_costs: j.actualOtherCosts,
 *         actual_revenue_collected: j.actualRevenueCollected,
 *         estimated_job_cost: j.estimatedJobCost,
 *         lines: j.lines, created_at: j.createdAt, updated_at: j.updatedAt,
 *       });
 *     }
 *
 *     // Rate card profiles
 *     for (const p of raw['amplified_rate_profiles_v1'] ?? []) {
 *       await supabase.from('rate_card_profiles').upsert({
 *         id: p.id, client_name: p.clientName, rows: p.rows, terms: p.terms,
 *         created_at: p.createdAt, updated_at: p.updatedAt,
 *       });
 *     }
 *
 *     // Current rate state
 *     if (raw['amplified_rate_rows_v9']) {
 *       await supabase.from('app_rate_state').upsert({ key: 'rate_rows', value: raw['amplified_rate_rows_v9'] });
 *     }
 *     if (raw['amplified_rate_terms_v9']) {
 *       await supabase.from('app_rate_state').upsert({ key: 'terms', value: raw['amplified_rate_terms_v9'] });
 *     }
 *     if (raw['amplified_rate_client_v9']) {
 *       await supabase.from('app_rate_state').upsert({ key: 'client_name', value: raw['amplified_rate_client_v9'] });
 *     }
 *
 *     console.log('Seed complete.');
 *   }
 *
 *   seed().catch(console.error);
 */

// This file is documentation only — no runtime code.
export {};
