import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// Simple in-process mutex per lock name. Used in place of the default
// navigator-locks–based coordination that gotrue-js uses.
//
// Why: navigator.locks coordinates across browser tabs, but its
// acquire-with-timeout produces a 5-second wait when a "lock not
// released" condition is detected (orphaned mounts, multiple supabase
// clients, etc.). We don't need cross-tab coordination for this app
// — a process-local lock is enough and avoids the 5s tax entirely.
const _locks = new Map<string, Promise<unknown>>();
async function processLock<R>(name: string, _acquireTimeout: number, fn: () => Promise<R>): Promise<R> {
  const prev = _locks.get(name) ?? Promise.resolve();
  let release: () => void;
  const next = new Promise<void>((res) => { release = res; });
  _locks.set(name, next);
  try {
    await prev;
    return await fn();
  } finally {
    release!();
    if (_locks.get(name) === next) _locks.delete(name);
  }
}

// Singleton — Next.js code-splitting + RSC client-component boundaries
// can otherwise create multiple Supabase clients per browser session.
// Stashing on globalThis ensures one client across module evaluations.
declare global {
  // eslint-disable-next-line no-var
  var __supabaseClient__: SupabaseClient | undefined;
}

export const supabase: SupabaseClient =
  globalThis.__supabaseClient__ ??
  (globalThis.__supabaseClient__ = createClient(supabaseUrl, supabaseAnonKey, {
    // Replace the default navigatorLock with a process-local mutex.
    // Eliminates "Lock ... was not released within 5000ms" 5-second waits.
    auth: { lock: processLock } as any,
  }));
