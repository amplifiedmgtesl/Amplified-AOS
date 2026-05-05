/**
 * lib/rates/storage.ts
 *
 * Rate card data API. Reads from the in-memory cache; writes sync to Supabase.
 * Active profile ID is UI state and stays in localStorage.
 */

import * as db from "../store/db";
import { loadJSON, saveJSON } from "../store/local";
import { DEFAULT_RATE_ROWS, type RateRow, type RateCardProfile } from "./defaults";

// Re-export types so existing imports from this file still work.
export type { RateRow, RateCardProfile };

// ─── Current rate card state ──────────────────────────────────────────────────

export function loadRateRows(): RateRow[] { return db.getRateRows(); }
export function saveRateRows(rows: RateRow[]) { db.setRateRows(rows); }

export function loadTerms(): string { return db.getTerms(); }
export function saveTerms(value: string) { db.setTerms(value); }

export function loadClientName(): string { return db.getClientName(); }
export function saveClientName(value: string) { db.setClientName(value); }

// ─── Rate card profiles ───────────────────────────────────────────────────────

export function loadRateCardProfiles(): RateCardProfile[] { return db.getRateCardProfiles(); }

export function saveRateCardProfiles(rows: RateCardProfile[]) {
  for (const r of rows) db.upsertRateCardProfile(r);
}

export function upsertRateCardProfile(profile: RateCardProfile) {
  db.upsertRateCardProfile(profile);
}

// Active profile — UI state, stays in localStorage
export function getActiveRateCardProfileId(): string {
  return loadJSON<string>("amplified_rate_active_profile_v1", "");
}
export function setActiveRateCardProfileId(id: string) {
  saveJSON("amplified_rate_active_profile_v1", id);
}

export function loadProfileIntoCurrent(id: string) {
  const profile = db.getRateCardProfiles().find((p) => p.id === id);
  if (!profile) return;
  saveClientName(profile.clientName);
  saveRateRows(profile.rows);
  saveTerms(profile.terms);
  setActiveRateCardProfileId(profile.id);
}
