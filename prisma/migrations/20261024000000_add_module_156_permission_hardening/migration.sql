-- Module 156 — permission hardening of the M156 objects (corrective, ADDITIVE: the two earlier M156 migrations are not edited).
--
-- Why: the audit found that the two M156 tables and the dispute-facts view were created without RLS and without any explicit
-- revocation, i.e. exactly what the Module 33 checklist (20260811000000_enable_row_level_security) says a new table must not do.
-- On a Supabase-hosted database every new `public` object is granted to the PostgREST roles `anon` / `authenticated` by default.
--
-- Connection model assumed (documented in the Module 33 migration and Module 107 report, not invented here): the application has
-- ONE database credential (`DATABASE_URL`) that connects as the role which OWNS every Prisma-created object (`postgres`). A table
-- owner bypasses RLS unless FORCE ROW LEVEL SECURITY is set, so enabling RLS with NO policies denies every non-owner role and does
-- not affect a single Prisma query. FORCE is deliberately NOT used (it would break the owner connection).
--
--   1. ENABLE ROW LEVEL SECURITY on "lead_abuse_signals" and "lead_abuse_decisions" (no policies = default deny for non-owners).
--   2. REVOKE ALL on the two tables and the view FROM PUBLIC (a no-op on a stock cluster, defence in depth elsewhere).
--   3. Where the Supabase roles exist, REVOKE ALL on exactly these three objects FROM anon and authenticated (same guarded DO-block
--      pattern as the Module 33 migration, so a bare local / CI PostgreSQL still applies this migration).
--   4. On PostgreSQL >= 15 make the view SECURITY INVOKER: it then reads the M155 tables with the CALLER's privileges instead of the
--      owner's, so a mistaken future GRANT on the view cannot leak M155 rows past the base tables' own protection. On older servers
--      the option does not exist; the REVOKEs above are the control (the view stays owner-privileged and is simply not granted).
--
-- The view stays read-only (a UNION ALL view is not auto-updatable) and exposes only kind / professionalUserId / occurredAt.
-- Nothing here touches M153–M155 objects. Not done on purpose (owner decision, see docs/MODULE_156_*): ALTER DEFAULT PRIVILEGES and
-- the 46 older tables that also lack RLS.
--
-- Rollback (manual):
--   ALTER TABLE "lead_abuse_signals" DISABLE ROW LEVEL SECURITY; ALTER TABLE "lead_abuse_decisions" DISABLE ROW LEVEL SECURITY;
--   ALTER VIEW "lead_abuse_professional_dispute_facts" RESET (security_invoker);   -- PostgreSQL >= 15 only
-- (revoked grants are not restored; none were intended).

ALTER TABLE "public"."lead_abuse_signals" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."lead_abuse_decisions" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."lead_abuse_signals" FROM PUBLIC;
REVOKE ALL ON TABLE "public"."lead_abuse_decisions" FROM PUBLIC;
REVOKE ALL ON TABLE "public"."lead_abuse_professional_dispute_facts" FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON TABLE "public"."lead_abuse_signals", "public"."lead_abuse_decisions", "public"."lead_abuse_professional_dispute_facts" FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON TABLE "public"."lead_abuse_signals", "public"."lead_abuse_decisions", "public"."lead_abuse_professional_dispute_facts" FROM authenticated';
  END IF;
  IF current_setting('server_version_num')::integer >= 150000 THEN
    EXECUTE 'ALTER VIEW "public"."lead_abuse_professional_dispute_facts" SET (security_invoker = true)';
  END IF;
END $$;
