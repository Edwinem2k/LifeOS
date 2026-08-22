-- 008_views_security_invoker.sql
--
-- SECURITY FIX: every view in 002_views.sql bypasses row-level security.
--
-- All seven views are owned by `postgres`, which carries bypassrls=true. A
-- Postgres view without `security_invoker` executes with the OWNER's
-- privileges, so RLS on the underlying tables never applies — even though
-- `habits`, `tasks`, `goals` and `projects` all have relrowsecurity=true with
-- a correct `user_id = auth.uid()` policy.
--
-- src/services/views.ts queries every view as `.from(view).select("*")` with
-- no user_id filter, relying entirely on the RLS these views were skipping.
--
-- Observed 22 Aug 2026: logged in as 633325fe-…, the Today page rendered the
-- habits "Gym" and "Morning pages" belonging to placeholder user
-- 00000000-0000-0000-0000-000000000001. Any authenticated user could read
-- every other user's rows through these views.
--
-- security_invoker requires PG15+; this database is 17.6.
--
-- Unaffected by this change:
--   - the MCP server, which connects with the service_role key (bypassrls=true)
--   - anything using DATABASE_URL as postgres (bypassrls=true)
-- Affected by design:
--   - the browser client, which uses the anon key and authenticates as
--     `authenticated` (bypassrls=false) — it will now see only its own rows
--
-- NOTE: role `life_os_agent` has bypassrls=false and holds SELECT on these
-- views. If anything ever connects as that role it will now be filtered by RLS
-- and, having no auth.uid(), will read zero rows. Nothing currently uses it.
--
-- To reverse: alter view <name> set (security_invoker = false);

alter view today_agenda        set (security_invoker = true);
alter view weekly_review       set (security_invoker = true);
alter view habit_stats         set (security_invoker = true);
alter view project_progress    set (security_invoker = true);
alter view goal_progress       set (security_invoker = true);
alter view area_progress       set (security_invoker = true);
alter view exercises_available set (security_invoker = true);
