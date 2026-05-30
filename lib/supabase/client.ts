import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// Singleton client — Next.js code-splitting + RSC client-component boundaries
// can cause this module to be evaluated multiple times in the same browser
// session, each creating a fresh Supabase client. Each client tries to
// acquire the navigator-lock for the auth token (`lock:sb-<project>-auth-token`).
// When they conflict, gotrue-js waits 5 seconds before force-recovering, which
// shows up in the console as:
//   "Lock 'lock:sb-...-auth-token' was not released within 5000ms"
// and adds 5s to every auth-needing fetch.
//
// Stashing the instance on globalThis ensures one client is reused across
// module evaluations.
declare global {
  // eslint-disable-next-line no-var
  var __supabaseClient__: SupabaseClient | undefined;
}

export const supabase: SupabaseClient =
  globalThis.__supabaseClient__ ??
  (globalThis.__supabaseClient__ = createClient(supabaseUrl, supabaseAnonKey));
