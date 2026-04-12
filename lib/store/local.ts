import { queueCloudWrite } from "./cloud-sync";

export function loadJSON<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  const raw = window.localStorage.getItem(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function saveJSON<T>(key: string, value: T) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key, JSON.stringify(value));
  queueCloudWrite(key);
}
