
import { DEFAULT_RATE_ROWS, DEFAULT_TERMS, type RateRow } from "./defaults";

export type RateCardProfile = {
  id: string;
  clientName: string;
  rows: RateRow[];
  terms: string;
  createdAt: string;
  updatedAt: string;
};

const RATES_KEY = "amplified_rate_rows_v9";
const TERMS_KEY = "amplified_rate_terms_v9";
const CLIENT_KEY = "amplified_rate_client_v9";
const PROFILES_KEY = "amplified_rate_profiles_v1";
const ACTIVE_PROFILE_KEY = "amplified_rate_active_profile_v1";

export function loadRateRows(): RateRow[] {
  if (typeof window === "undefined") return DEFAULT_RATE_ROWS;
  const raw = window.localStorage.getItem(RATES_KEY);
  if (!raw) return DEFAULT_RATE_ROWS;
  try { return JSON.parse(raw) as RateRow[]; } catch { return DEFAULT_RATE_ROWS; }
}
export function saveRateRows(rows: RateRow[]) {
  if (typeof window !== "undefined") window.localStorage.setItem(RATES_KEY, JSON.stringify(rows));
}
export function loadTerms(): string {
  if (typeof window === "undefined") return DEFAULT_TERMS;
  return window.localStorage.getItem(TERMS_KEY) || DEFAULT_TERMS;
}
export function saveTerms(value: string) {
  if (typeof window !== "undefined") window.localStorage.setItem(TERMS_KEY, value);
}
export function loadClientName(): string {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(CLIENT_KEY) || "";
}
export function saveClientName(value: string) {
  if (typeof window !== "undefined") window.localStorage.setItem(CLIENT_KEY, value);
}

export function loadRateCardProfiles(): RateCardProfile[] {
  if (typeof window === "undefined") return [];
  const raw = window.localStorage.getItem(PROFILES_KEY);
  if (!raw) return [];
  try { return JSON.parse(raw) as RateCardProfile[]; } catch { return []; }
}
export function saveRateCardProfiles(rows: RateCardProfile[]) {
  if (typeof window !== "undefined") window.localStorage.setItem(PROFILES_KEY, JSON.stringify(rows));
}
export function getActiveRateCardProfileId(): string {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(ACTIVE_PROFILE_KEY) || "";
}
export function setActiveRateCardProfileId(id: string) {
  if (typeof window !== "undefined") window.localStorage.setItem(ACTIVE_PROFILE_KEY, id);
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
