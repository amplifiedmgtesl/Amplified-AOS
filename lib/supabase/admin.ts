/**
 * lib/supabase/admin.ts
 *
 * Server-side Supabase client using the service role key.
 * NEVER import this in client components or pages — it must only be used
 * inside Next.js API route handlers (app/api/**).
 *
 * The service role key bypasses RLS and can manage auth users.
 */

import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!serviceRoleKey) {
  throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set in environment variables.");
}

export const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});
