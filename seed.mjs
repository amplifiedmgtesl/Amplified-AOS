import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const SUPABASE_URL = 'https://wmssllfmahotppoyxxrr.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Indtc3NsbGZtYWhvdHBwb3l4eHJyIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDY0MTk5NiwiZXhwIjoyMDkwMjE3OTk2fQ.HHWlK1_mYd3BPDngBEC91k7IBRYDt-dBdREsOXVNYqs';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const raw = JSON.parse(fs.readFileSync('./export.json', 'utf8'));

async function upsert(table, row) {
  const { error } = await supabase.from(table).upsert(row);
  if (error) console.error(`ERROR [${table}]:`, error.message, '|', JSON.stringify(row).slice(0, 120));
}

async function seed() {
  // Calendar events
  const events = raw['aes_manual_events_v2'] ?? [];
  const deletedIds = new Set(raw['aes_deleted_event_ids_v1'] ?? []);
  const profiles = raw['aes_event_profiles_v1'] ?? {};
  console.log(`Seeding ${events.length} calendar events...`);
  for (const e of events) {
    const profile = profiles[e.id];
    await upsert('calendar_events', {
      id: e.id, source: e.source, client: e.client,
      event_name: e.eventName, venue: e.venue,
      venue_address: e.venueAddress ?? null, city: e.city ?? null,
      state: e.state ?? null, city_state: e.cityState,
      google_maps_link: e.googleMapsLink ?? null,
      start_date: e.startDate, end_date: e.endDate,
      start_time: e.startTime, end_time: e.endTime,
      notes: e.notes, status: e.status,
      lead: e.lead ?? null, hands: e.hands ?? null,
      is_deleted: deletedIds.has(e.id),
      profile_notes: profile?.notes ?? null,
      profile_attachment_names: profile?.attachmentNames ?? [],
    });
  }

  // Quotes
  const quotes = raw['aes_quotes_v2'] ?? [];
  console.log(`Seeding ${quotes.length} quotes...`);
  for (const q of quotes) {
    await upsert('quotes', {
      id: q.id, client: q.client, event_name: q.eventName,
      venue: q.venue, city_state: q.cityState,
      start_date: q.startDate, end_date: q.endDate,
      start_time: q.startTime, end_time: q.endTime,
      expected_hours_per_day: q.expectedHoursPerDay ?? null,
      total: q.total, deposit: q.deposit, status: q.status,
      notes: q.notes, lines: q.lines, terms: q.terms,
      linked_job_request_id: q.linkedJobRequestId ?? null,
      linked_job_sheet_id: q.linkedJobSheetId ?? null,
      timesheet_summary: q.timesheetSummary ?? null,
      signature_name: q.signatureName ?? null,
      signed_at: q.signedAt ?? null,
      rate_card_profile_id: q.rateCardProfileId ?? null,
    });
  }

  // Quote draft workspaces
  const workspaces = raw['aes_quote_drafts_v1'] ?? [];
  console.log(`Seeding ${workspaces.length} quote draft workspaces...`);
  for (const w of workspaces) {
    await upsert('quote_draft_workspaces', {
      id: w.id, name: w.name, updated_at: w.updatedAt, data: w.data,
    });
  }

  // Invoices
  const invoices = raw['aes_invoice_drafts_v2'] ?? [];
  console.log(`Seeding ${invoices.length} invoices...`);
  for (const inv of invoices) {
    await upsert('invoices', {
      id: inv.id, quote_id: inv.quoteId, invoice_no: inv.invoiceNo,
      issue_date: inv.issueDate, due_date: inv.dueDate,
      po_no: inv.poNo, bill_to: inv.billTo, client: inv.client,
      event_name: inv.eventName, venue: inv.venue, city_state: inv.cityState,
      lines: inv.lines, subtotal: inv.subtotal, deposit: inv.deposit,
      amount_due: inv.amountDue, terms: inv.terms, notes: inv.notes,
      status: inv.status, paid_amount: inv.paidAmount,
      rate_card_profile_id: inv.rateCardProfileId ?? null,
      linked_job_sheet_id: inv.linkedJobSheetId ?? null,
      timesheet_summary: inv.timesheetSummary ?? null,
    });
  }

  // Job requests
  const jobRequests = raw['aes_job_requests_v2'] ?? [];
  console.log(`Seeding ${jobRequests.length} job requests...`);
  for (const j of jobRequests) {
    await upsert('job_requests', {
      id: j.id, client: j.client, event_name: j.eventName,
      venue: j.venue, venue_address: j.venueAddress,
      city: j.city, state: j.state, city_state: j.cityState,
      google_maps_link: j.googleMapsLink, request_date: j.requestDate,
      end_date: j.endDate ?? null, start_time: j.startTime, end_time: j.endTime,
      expected_hours: j.expectedHours ?? null,
      add_to_calendar: j.addToCalendar ?? null,
      status: j.status, notes: j.notes,
      attachment_names: j.attachmentNames, packet_notes: j.packetNotes,
    });
  }

  // Job sheets
  const jobSheets = raw['aes_job_sheets_v2'] ?? [];
  console.log(`Seeding ${jobSheets.length} job sheets...`);
  for (const j of jobSheets) {
    await upsert('job_sheets', {
      id: j.id, source_event_id: j.sourceEventId ?? null,
      title: j.title, client: j.client, event_name: j.eventName,
      venue: j.venue, venue_address: j.venueAddress ?? null,
      city: j.city ?? null, state: j.state ?? null, city_state: j.cityState,
      google_maps_link: j.googleMapsLink ?? null,
      date: j.date, call_time: j.callTime, notes: j.notes,
      attachment_names: j.attachmentNames, workers: j.workers,
    });
  }

  // Timesheets
  const timesheets = raw['aes_timesheets_v1'] ?? [];
  console.log(`Seeding ${timesheets.length} timesheets...`);
  for (const t of timesheets) {
    await upsert('timesheets', {
      id: t.id, job_sheet_id: t.jobSheetId, title: t.title,
      hide_pay_columns: t.hidePayColumns, rows: t.rows,
    });
  }

  // Employees
  const employees = raw['aes_employees_v1'] ?? [];
  console.log(`Seeding ${employees.length} employees...`);
  for (const e of employees) {
    await upsert('employees', {
      employee_key: e.employeeKey, employee_id: e.employeeId ?? null,
      full_name: e.fullName, first_name: e.firstName ?? null,
      last_name: e.lastName ?? null, payroll_name: e.payrollName ?? null,
      preferred_name: e.preferredName ?? null, status: e.status ?? null,
      worker_category: e.workerCategory ?? null,
      position_status: e.positionStatus ?? null,
      employment_type: e.employmentType ?? null,
      city: e.city ?? null, state: e.state ?? null,
      state_code: e.stateCode ?? null, email: e.email ?? null,
      phone: e.phone ?? null, address: e.address ?? null,
      notes: e.notes ?? null, profile_picture: e.profilePicture ?? null,
      documents: e.documents ?? [], source: e.source ?? null,
      is_deleted: false,
    });
  }

  // Job costing
  const jobCosting = raw['aes_job_costing_drafts_v1'] ?? [];
  console.log(`Seeding ${jobCosting.length} job costing drafts...`);
  for (const j of jobCosting) {
    await upsert('job_costing_drafts', {
      id: j.id, title: j.title, client: j.client,
      event_name: j.eventName, venue: j.venue, city_state: j.cityState,
      linked_job_request_id: j.linkedJobRequestId ?? null,
      linked_quote_id: j.linkedQuoteId ?? null,
      linked_job_sheet_id: j.linkedJobSheetId ?? null,
      linked_timesheet_id: j.linkedTimesheetId ?? null,
      linked_rate_card_profile_id: j.linkedRateCardProfileId ?? null,
      payroll_burden: j.payrollBurden, overhead_per_hour: j.overheadPerHour,
      target_margin: j.targetMargin, ot_pay_multiplier: j.otPayMultiplier,
      dt_pay_multiplier: j.dtPayMultiplier, ot_bill_multiplier: j.otBillMultiplier,
      dt_bill_multiplier: j.dtBillMultiplier, minimum_hours: j.minimumHours,
      billed_expenses: j.billedExpenses, rentals: j.rentals,
      pass_through_markup_revenue: j.passThroughMarkupRevenue,
      actual_travel: j.actualTravel, actual_hotels: j.actualHotels,
      actual_per_diem: j.actualPerDiem, actual_equipment: j.actualEquipment,
      actual_other_costs: j.actualOtherCosts,
      actual_revenue_collected: j.actualRevenueCollected,
      estimated_job_cost: j.estimatedJobCost,
      lines: j.lines, created_at: j.createdAt, updated_at: j.updatedAt,
    });
  }

  // Rate card profiles
  const rateProfiles = raw['amplified_rate_profiles_v1'] ?? [];
  console.log(`Seeding ${rateProfiles.length} rate card profiles...`);
  for (const p of rateProfiles) {
    await upsert('rate_card_profiles', {
      id: p.id, client_name: p.clientName, rows: p.rows, terms: p.terms,
      created_at: p.createdAt, updated_at: p.updatedAt,
    });
  }

  // Current rate state
  if (raw['amplified_rate_rows_v9']) {
    console.log('Seeding rate rows...');
    await upsert('app_rate_state', { key: 'rate_rows', value: raw['amplified_rate_rows_v9'] });
  }
  if (raw['amplified_rate_terms_v9']) {
    await upsert('app_rate_state', { key: 'terms', value: raw['amplified_rate_terms_v9'] });
  }
  if (raw['amplified_rate_client_v9']) {
    await upsert('app_rate_state', { key: 'client_name', value: raw['amplified_rate_client_v9'] });
  }

  console.log('Seed complete.');
}

seed().catch(console.error);
