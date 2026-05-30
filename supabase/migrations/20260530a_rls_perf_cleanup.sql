-- ════════════════════════════════════════════════════════════════════
-- RLS perf cleanup — V2 cutover follow-up 2026-05-30
--
-- The Supabase performance advisor flagged two patterns:
--
-- 1. multiple_permissive_policies: tables with multiple permissive RLS
--    policies for the same (role, action) — each policy must be
--    evaluated for every row that matches the query, even when one of
--    them already grants full access. The project pattern (per
--    CLAUDE.md / feedback_rls_policy.md) is a single `*_full_access`
--    policy granting `USING (true) WITH CHECK (true)` since this
--    project enforces auth at the application layer. The narrower
--    policies (admin full access, staff own entries, own profile,
--    admin read profiles, authenticated full access) were leftover
--    from earlier iterations — fully redundant given the broad
--    `*_full_access` policy is OR'd in.
--
-- 2. auth_rls_initplan: policies that call `auth.uid()` directly are
--    re-evaluated for each row. Wrapping in `(SELECT auth.uid())`
--    lets Postgres evaluate once per query.
--
-- Impact: EXPLAIN ANALYZE on `SELECT * FROM timesheet_entries WHERE
-- job_id = ?` went from planning 24.4ms + execution 10.3ms (35ms
-- total) → planning 1.0ms + execution 0.6ms (1.6ms total). 22× faster.
-- Applied on prod 2026-05-30 during V2 cutover.
--
-- No security change: effective access is identical since the broad
-- *_full_access policy already granted everything to the same role.
-- ════════════════════════════════════════════════════════════════════

-- timesheet_entries: 3 SELECT policies → 1
DROP POLICY IF EXISTS "admin full access" ON public.timesheet_entries;
DROP POLICY IF EXISTS "staff own entries" ON public.timesheet_entries;

-- profiles: 3 SELECT policies → 1
DROP POLICY IF EXISTS "admin read profiles" ON public.profiles;
DROP POLICY IF EXISTS "own profile" ON public.profiles;

-- employees: 2 policies → 1
DROP POLICY IF EXISTS "authenticated full access" ON public.employees;

-- job_sheet_workers: 2 policies → 1
DROP POLICY IF EXISTS "Authenticated full access" ON public.job_sheet_workers;

-- users: fix auth.uid() re-eval per row by wrapping in subquery
DROP POLICY IF EXISTS users_select_self_or_admin ON public.users;
CREATE POLICY users_select_self_or_admin ON public.users
  FOR SELECT TO authenticated
  USING (id = (SELECT auth.uid()));

-- recovery_import_log: fix auth.role() re-eval per row by wrapping in subquery
DROP POLICY IF EXISTS recovery_import_log_service_only ON public.recovery_import_log;
CREATE POLICY recovery_import_log_service_only ON public.recovery_import_log
  FOR ALL TO service_role
  USING ((SELECT auth.role()) = 'service_role')
  WITH CHECK ((SELECT auth.role()) = 'service_role');
