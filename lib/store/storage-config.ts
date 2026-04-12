export const STORAGE_KEYS = {
  manualEvents: "aes_manual_events_v2",
  deletedEventIds: "aes_deleted_event_ids_v1",
  eventProfiles: "aes_event_profiles_v1",
  quotes: "aes_quotes_v2",
  invoiceDrafts: "aes_invoice_drafts_v2",
  activeInvoice: "aes_active_invoice_v2",
  quoteSeed: "aes_quote_seed_v2",
  activeQuote: "aes_active_quote_v1",
  quoteDrafts: "aes_quote_drafts_v1",
  activeQuoteDraft: "aes_active_quote_draft_v1",
  jobRequests: "aes_job_requests_v2",
  jobSheets: "aes_job_sheets_v2",
  activeJobSheet: "aes_active_job_sheet_v2",
  timesheets: "aes_timesheets_v1",
  employees: "aes_employees_v1",
  activeEmployee: "aes_active_employee_v1",
  deletedEmployeeKeys: "aes_deleted_employee_keys_v1",
  jobCostingDrafts: "aes_job_costing_drafts_v1",
  activeJobCosting: "aes_active_job_costing_v1",
  rateRows: "amplified_rate_rows_v9",
  rateTerms: "amplified_rate_terms_v9",
  rateClient: "amplified_rate_client_v9",
  rateProfiles: "amplified_rate_profiles_v1",
  activeRateProfile: "amplified_rate_active_profile_v1",
} as const;

export type StorageKey = (typeof STORAGE_KEYS)[keyof typeof STORAGE_KEYS];

export const COLLECTION_CONFIG: Record<string, { dataset: string; idField: string }> = {
  [STORAGE_KEYS.manualEvents]: { dataset: "manual_events", idField: "id" },
  [STORAGE_KEYS.quotes]: { dataset: "quotes", idField: "id" },
  [STORAGE_KEYS.invoiceDrafts]: { dataset: "invoice_drafts", idField: "id" },
  [STORAGE_KEYS.quoteDrafts]: { dataset: "quote_draft_workspaces", idField: "id" },
  [STORAGE_KEYS.jobRequests]: { dataset: "job_requests", idField: "id" },
  [STORAGE_KEYS.jobSheets]: { dataset: "job_sheets", idField: "id" },
  [STORAGE_KEYS.timesheets]: { dataset: "timesheets", idField: "id" },
  [STORAGE_KEYS.employees]: { dataset: "employees", idField: "employeeKey" },
  [STORAGE_KEYS.jobCostingDrafts]: { dataset: "job_costing_drafts", idField: "id" },
  [STORAGE_KEYS.rateProfiles]: { dataset: "rate_card_profiles", idField: "id" },
};

export const STATE_CONFIG: Record<string, { stateKey: string }> = {
  [STORAGE_KEYS.deletedEventIds]: { stateKey: "deleted_event_ids" },
  [STORAGE_KEYS.eventProfiles]: { stateKey: "event_profiles" },
  [STORAGE_KEYS.activeInvoice]: { stateKey: "active_invoice" },
  [STORAGE_KEYS.quoteSeed]: { stateKey: "quote_seed" },
  [STORAGE_KEYS.activeQuote]: { stateKey: "active_quote" },
  [STORAGE_KEYS.activeQuoteDraft]: { stateKey: "active_quote_draft" },
  [STORAGE_KEYS.activeJobSheet]: { stateKey: "active_job_sheet" },
  [STORAGE_KEYS.activeEmployee]: { stateKey: "active_employee" },
  [STORAGE_KEYS.deletedEmployeeKeys]: { stateKey: "deleted_employee_keys" },
  [STORAGE_KEYS.activeJobCosting]: { stateKey: "active_job_costing" },
  [STORAGE_KEYS.rateRows]: { stateKey: "rate_rows" },
  [STORAGE_KEYS.rateTerms]: { stateKey: "rate_terms" },
  [STORAGE_KEYS.rateClient]: { stateKey: "rate_client" },
  [STORAGE_KEYS.activeRateProfile]: { stateKey: "active_rate_profile" },
};

export function isCollectionStorageKey(key: string): key is keyof typeof COLLECTION_CONFIG {
  return key in COLLECTION_CONFIG;
}

export function isStateStorageKey(key: string): key is keyof typeof STATE_CONFIG {
  return key in STATE_CONFIG;
}
