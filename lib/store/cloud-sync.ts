"use client";

import { hasSupabaseEnv, supabase } from "@/lib/supabase/client";
import { COLLECTION_CONFIG, STATE_CONFIG, isCollectionStorageKey, isStateStorageKey } from "./storage-config";

const RECORDS_TABLE = "app_records";
const STATE_TABLE = "app_state";
const SYNCED_FLAG = "aes_cloud_sync_bootstrapped_v1";
const RELOAD_FLAG = "aes_cloud_sync_reloaded_v1";
const WRITE_DELAY_MS = 500;

const writeTimers = new Map<string, number>();
let initPromise: Promise<void> | null = null;

function canUseBrowserStorage() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function emitStoreChanged() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("aes:store-changed"));
}

function setLocalValue(key: string, value: unknown) {
  if (!canUseBrowserStorage()) return;
  window.localStorage.setItem(key, JSON.stringify(value));
}

function readLocalValue<T>(key: string, fallback: T): T {
  if (!canUseBrowserStorage()) return fallback;
  const raw = window.localStorage.getItem(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function valuesDiffer(a: unknown, b: unknown) {
  return JSON.stringify(a) !== JSON.stringify(b);
}

async function pushCollection(dataset: string, idField: string, rows: unknown[]) {
  if (!supabase) return;

  const { error: deleteError } = await supabase.from(RECORDS_TABLE).delete().eq("dataset", dataset);
  if (deleteError) throw deleteError;

  if (!rows.length) return;

  const payload = rows.map((row) => {
    const record = row as Record<string, unknown>;
    const recordId = String(record[idField] ?? "");
    if (!recordId) {
      throw new Error(`Missing "${idField}" for dataset "${dataset}"`);
    }
    return {
      dataset,
      record_id: recordId,
      payload: row,
      updated_at: new Date().toISOString(),
    };
  });

  const { error: insertError } = await supabase.from(RECORDS_TABLE).upsert(payload, {
    onConflict: "dataset,record_id",
  });
  if (insertError) throw insertError;
}

async function pushState(stateKey: string, payload: unknown) {
  if (!supabase) return;
  const { error } = await supabase.from(STATE_TABLE).upsert({
    key: stateKey,
    payload,
    updated_at: new Date().toISOString(),
  });
  if (error) throw error;
}

async function flushStorageKey(key: string) {
  if (!canUseBrowserStorage() || !supabase) return;

  if (isCollectionStorageKey(key)) {
    const { dataset, idField } = COLLECTION_CONFIG[key];
    const rows = readLocalValue<unknown[]>(key, []);
    await pushCollection(dataset, idField, rows);
    return;
  }

  if (isStateStorageKey(key)) {
    const { stateKey } = STATE_CONFIG[key];
    const payload = readLocalValue<unknown | null>(key, null);
    await pushState(stateKey, payload);
  }
}

export function queueCloudWrite(key: string) {
  if (!canUseBrowserStorage() || !hasSupabaseEnv || !supabase) return;
  const existing = writeTimers.get(key);
  if (existing) {
    window.clearTimeout(existing);
  }
  const timer = window.setTimeout(async () => {
    writeTimers.delete(key);
    try {
      await flushStorageKey(key);
    } catch (error) {
      console.error(`Cloud sync write failed for ${key}`, error);
    }
  }, WRITE_DELAY_MS);
  writeTimers.set(key, timer);
}

export async function initializeCloudSync() {
  if (!canUseBrowserStorage() || !hasSupabaseEnv || !supabase) return;
  if (window.sessionStorage.getItem(SYNCED_FLAG) === "true") return;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      const [{ data: recordRows, error: recordError }, { data: stateRows, error: stateError }] = await Promise.all([
        supabase.from(RECORDS_TABLE).select("dataset, record_id, payload"),
        supabase.from(STATE_TABLE).select("key, payload"),
      ]);

      if (recordError) throw recordError;
      if (stateError) throw stateError;

      let changed = false;

      const groupedCollections = new Map<string, unknown[]>();
      for (const row of recordRows ?? []) {
        const dataset = String((row as { dataset: string }).dataset);
        const payload = (row as { payload: unknown }).payload;
        const current = groupedCollections.get(dataset) ?? [];
        current.push(payload);
        groupedCollections.set(dataset, current);
      }

      for (const [storageKey, config] of Object.entries(COLLECTION_CONFIG)) {
        const remoteRows = groupedCollections.get(config.dataset);
        const localExists = window.localStorage.getItem(storageKey) !== null;
        if (!remoteRows) continue;
        if (!remoteRows.length && localExists) continue;
        const localRows = readLocalValue<unknown[]>(storageKey, []);
        if (valuesDiffer(localRows, remoteRows)) {
          setLocalValue(storageKey, remoteRows);
          changed = true;
        }
      }

      for (const [storageKey, config] of Object.entries(STATE_CONFIG)) {
        const remoteRow = (stateRows ?? []).find((row) => String((row as { key: string }).key) === config.stateKey);
        if (!remoteRow) continue;
        const remotePayload = (remoteRow as { payload: unknown }).payload;
        const localPayload = readLocalValue<unknown | null>(storageKey, null);
        if (valuesDiffer(localPayload, remotePayload)) {
          setLocalValue(storageKey, remotePayload);
          changed = true;
        }
      }

      window.sessionStorage.setItem(SYNCED_FLAG, "true");
      emitStoreChanged();

      if (changed && window.sessionStorage.getItem(RELOAD_FLAG) !== "true") {
        window.sessionStorage.setItem(RELOAD_FLAG, "true");
        window.location.reload();
      }
    } catch (error) {
      console.error("Cloud sync bootstrap failed", error);
    }
  })();

  return initPromise;
}

export async function exportLocalStateToCloud() {
  if (!canUseBrowserStorage() || !hasSupabaseEnv || !supabase) {
    throw new Error("Supabase environment variables are missing.");
  }

  for (const storageKey of Object.keys(COLLECTION_CONFIG)) {
    await flushStorageKey(storageKey);
  }
  for (const storageKey of Object.keys(STATE_CONFIG)) {
    await flushStorageKey(storageKey);
  }
}
