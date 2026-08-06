/**
 * lib/supabase/env-guard.ts
 *
 * Fail fast when a LOCAL dev server is pointed at the PRODUCTION database.
 *
 * Why this exists: `.env.local` on at least one dev machine has historically
 * pointed NEXT_PUBLIC_SUPABASE_URL at the prod project, so `npm run dev` read
 * and wrote LIVE customer data — real invoices, real timesheets, real payroll.
 * The team tests on Vercel previews rather than locally, which is the only
 * reason it never caused damage. That is luck, not a safeguard.
 *
 * The guard only fires during `next dev` (NODE_ENV === "development").
 * Vercel builds — production AND preview — run with NODE_ENV === "production",
 * so deployments are never affected by this file.
 *
 * Escape hatch: set ALLOW_PROD_DB_IN_DEV=true in .env.local to run locally
 * against prod deliberately (debugging a prod-only data issue, for example).
 * Making that an explicit, visible opt-in is the whole point — pointing at
 * prod should be a decision, not a default nobody remembers making.
 */

/** Supabase project ref for PRODUCTION (`amplified-aos`). The dev project is
 *  `ovtbvnfhteqxnyirzctt` (`amplified-aos-dev`) — note prod's name has no
 *  `-dev` suffix, which is exactly how these get mixed up. */
export const PROD_PROJECT_REF = "wmssllfmahotppoyxxrr";
export const DEV_PROJECT_REF = "ovtbvnfhteqxnyirzctt";

/** True when the URL points at the production Supabase project. */
export function isProdSupabaseUrl(url: string | undefined | null): boolean {
  return !!url && url.includes(PROD_PROJECT_REF);
}

/**
 * Throws when a development server is aimed at prod.
 *
 * Called at module scope by the Supabase clients, so the failure happens at
 * startup with a clear message rather than halfway through someone editing a
 * live invoice.
 */
export function assertNotProdInDev(url: string | undefined | null, clientLabel: string): void {
  if (process.env.NODE_ENV !== "development") return;
  if (!isProdSupabaseUrl(url)) return;
  if (process.env.ALLOW_PROD_DB_IN_DEV === "true") {
    // Deliberate opt-in — still make it impossible to miss in the log.
    console.warn(
      `\n⚠️  ${clientLabel} is pointed at PRODUCTION (${PROD_PROJECT_REF}) `
      + `while running locally.\n    ALLOW_PROD_DB_IN_DEV=true is set, so this is allowed. `
      + `Every write hits LIVE customer data.\n`,
    );
    return;
  }

  throw new Error(
    `\n\n🛑 Refusing to start: ${clientLabel} is pointed at the PRODUCTION database.\n\n`
    + `   NEXT_PUBLIC_SUPABASE_URL contains the prod project ref (${PROD_PROJECT_REF}).\n`
    + `   Running the local dev server against prod means every save writes LIVE\n`
    + `   customer data — invoices, timesheets, payroll.\n\n`
    + `   Fix: point .env.local at the dev project instead:\n`
    + `     NEXT_PUBLIC_SUPABASE_URL=https://${DEV_PROJECT_REF}.supabase.co\n`
    + `     NEXT_PUBLIC_SUPABASE_ANON_KEY=<the dev project's anon key>\n`
    + `     SUPABASE_SERVICE_ROLE_KEY=<the dev project's service role key>\n\n`
    + `   Both are in Supabase Dashboard → Project Settings → API.\n`
    + `   Note the naming trap: prod is "amplified-aos", dev is "amplified-aos-dev".\n\n`
    + `   If you genuinely need to run locally against prod, set:\n`
    + `     ALLOW_PROD_DB_IN_DEV=true\n\n`,
  );
}
