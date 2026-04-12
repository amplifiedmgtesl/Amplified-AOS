import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const raw = fs.readFileSync(process.argv[2] || "./local-export.json", "utf8");
const dump = JSON.parse(raw);

const COLLECTIONS = {
  aes_manual_events_v2: { dataset: "manual_events", idField: "id" },
  aes_quotes_v2: { dataset: "quotes", idField: "id" },
  aes_invoice_drafts_v2: { dataset: "invoice_drafts", idField: "id" },
  aes_quote_drafts_v1: { dataset: "quote_draft_workspaces", idField: "id" },
  aes_job_requests_v2: { dataset: "job_requests", idField: "id" },
  aes_job_sheets_v2: { dataset: "job_sheets", idField: "id" },
  aes_timesheets_v1: { dataset: "timesheets", idField: "id" },
  aes_employees_v1: { dataset: "employees", idField: "employeeKey" },
  aes_job_costing_drafts_v1: { dataset: "job_costing_drafts", idField: "id" },
  amplified_rate_profiles_v1: { dataset: "rate_card_profiles", idField: "id" },
};

const STATES = {
  aes_deleted_event_ids_v1: "deleted_event_ids",
  aes_event_profiles_v1: "event_profiles",
  aes_active_invoice_v2: "active_invoice",
  aes_quote_seed_v2: "quote_seed",
  aes_active_quote_v1: "active_quote",
  aes_active_quote_draft_v1: "active_quote_draft",
  aes_active_job_sheet_v2: "active_job_sheet",
  aes_active_employee_v1: "active_employee",
  aes_deleted_employee_keys_v1: "deleted_employee_keys",
  aes_active_job_costing_v1: "active_job_costing",
  amplified_rate_rows_v9: "rate_rows",
  amplified_rate_terms_v9: "rate_terms",
  amplified_rate_client_v9: "rate_client",
  amplified_rate_active_profile_v1: "active_rate_profile",
};

async function importCollections() {
  for (const [localKey, config] of Object.entries(COLLECTIONS)) {
    const rows = Array.isArray(dump[localKey]) ? dump[localKey] : [];

    const { error: deleteError } = await supabase
      .from("app_records")
      .delete()
      .eq("dataset", config.dataset);

    if (deleteError) throw deleteError;

    if (!rows.length) {
      console.log(`Skipped empty collection: ${config.dataset}`);
      continue;
    }

    const payload = rows
      .filter((row) => row && row[config.idField] !== null && row[config.idField] !== undefined)
      .map((row) => ({
        dataset: config.dataset,
        record_id: String(row[config.idField]),
        payload: row,
        updated_at: new Date().toISOString(),
      }));

    if (!payload.length) {
      console.log(`Skipped collection with no valid IDs: ${config.dataset}`);
      continue;
    }

    const { error } = await supabase.from("app_records").upsert(payload, {
      onConflict: "dataset,record_id",
    });

    if (error) throw error;
    console.log(`Imported ${payload.length} rows into ${config.dataset}`);
  }
}

async function importState() {
  const rows = Object.entries(STATES)
    .map(([localKey, cloudKey]) => ({
      key: cloudKey,
      payload: dump[localKey],
      updated_at: new Date().toISOString(),
    }))
    .filter((row) => row.payload !== null && row.payload !== undefined);

  if (!rows.length) {
    console.log("Skipped state import: no non-null state values found");
    return;
  }

  const { error } = await supabase.from("app_state").upsert(rows, {
    onConflict: "key",
  });

  if (error) throw error;
  console.log(`Imported ${rows.length} state keys (null values skipped)`);
}

async function main() {
  await importCollections();
  await importState();
  console.log("Done.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});