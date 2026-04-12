import { DEFAULT_RATE_ROWS, DEFAULT_TERMS, type RateRow } from "./defaults";
import { loadJSON, saveJSON } from "@/lib/store/local";
import { STORAGE_KEYS } from "@/lib/store/storage-config";

export type RateCardProfile = {
  id: string;
  clientName: string;
  rows: RateRow[];
  terms: string;
  createdAt: string;
  updatedAt: string;
};

export function loadRateRows(): RateRow[] {
  return loadJSON(STORAGE_KEYS.rateRows, DEFAULT_RATE_ROWS);
}
export function saveRateRows(rows: RateRow[]) {
  saveJSON(STORAGE_KEYS.rateRows, rows);
}
export function loadTerms(): string {
  return loadJSON(STORAGE_KEYS.rateTerms, DEFAULT_TERMS);
}
export function saveTerms(value: string) {
  saveJSON(STORAGE_KEYS.rateTerms, value);
}
export function loadClientName(): string {
  return loadJSON(STORAGE_KEYS.rateClient, "");
}
export function saveClientName(value: string) {
  saveJSON(STORAGE_KEYS.rateClient, value);
}

export function loadRateCardProfiles(): RateCardProfile[] {
  return loadJSON(STORAGE_KEYS.rateProfiles, []);
}
export function saveRateCardProfiles(rows: RateCardProfile[]) {
  saveJSON(STORAGE_KEYS.rateProfiles, rows);
}
export function getActiveRateCardProfileId(): string {
  return loadJSON(STORAGE_KEYS.activeRateProfile, "");
}
export function setActiveRateCardProfileId(id: string) {
  saveJSON(STORAGE_KEYS.activeRateProfile, id);
}
export function upsertRateCardProfile(profile: RateCardProfile) {
  const rows = loadRateCardProfiles();
  const next = [...rows.filter((r) => r.id !== profile.id), profile].sort((a,b)=>a.clientName.localeCompare(b.clientName));
  saveRateCardProfiles(next);
}
export function loadProfileIntoCurrent(id: string) {
  const profile = loadRateCardProfiles().find((p) => p.id === id);
  if (!profile) return;
  saveClientName(profile.clientName);
  saveRateRows(profile.rows);
  saveTerms(profile.terms);
  setActiveRateCardProfileId(profile.id);
}
