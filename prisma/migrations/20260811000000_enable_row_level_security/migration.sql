-- Module 33 — Security Hardening: enable Row Level Security on every table.
--
-- Context: this app's only database credential (`DATABASE_URL`, see
-- .env.example) connects through Supabase's connection pooler as the
-- `postgres` role, which owns every table created by Prisma's migrations.
-- Table owners bypass Row Level Security by default (that's exactly what
-- lets this migration itself, and every Prisma query the app already
-- makes, keep working unchanged — nothing here uses `FORCE ROW LEVEL
-- SECURITY`, which would additionally restrict the owner and break the
-- app).
--
-- What this closes: every Supabase project automatically provisions a
-- PostgREST-backed REST/GraphQL API over the `public` schema, reachable
-- with the project's `anon`/`authenticated` API keys. Those Postgres roles
-- are NOT table owners and do not have `BYPASSRLS`, so any table with RLS
-- disabled is fully readable/writable through that API by anyone holding
-- (or guessing/leaking) the project's anon key — completely bypassing this
-- application's own auth/authorization layer (NextAuth sessions, RBAC,
-- ownership checks in every use case). This is precisely the "Row Level
-- Security disabled" / "public tables" warning class Supabase's Advisor
-- flags for every table by default.
--
-- This app never uses supabase-js/PostgREST — all data access goes through
-- Prisma from trusted server code, with authorization enforced in the
-- application layer (see docs/ARCHITECTURE.md). There is therefore no
-- product need for row-level policies keyed on `auth.uid()`; the correct,
-- minimal-risk posture is: enable RLS on every table, and add NO policies.
-- With RLS enabled and zero policies, every role other than the owner
-- (i.e. `anon`, `authenticated`, and any future custom role) is denied ALL
-- access by default — the Postgres-documented "default-deny" behavior.
-- This is intentionally the same fix Supabase's own Advisor recommends for
-- "RLS disabled" and requires no apply-time downtime and no application
-- code change, since the app's `postgres`-owned Prisma connection is
-- entirely unaffected.
--
-- Every `@@map(...)` table name from prisma/schema.prisma is covered below
-- (55 tables). If a future migration adds a new model, its migration must
-- add a matching `ALTER TABLE ... ENABLE ROW LEVEL SECURITY;` line — see
-- docs/ARCHITECTURE.md for the checklist this should be added to.

ALTER TABLE "public"."users" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."accounts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."sessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."verification_tokens" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."email_verification_tokens" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."password_reset_tokens" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."refresh_tokens" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."languages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."roles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."user_roles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."countries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."provinces" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."cities" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."platform_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."addresses" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."customer_profiles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."professional_profiles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."company_profiles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."company_invitations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."company_verifications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."company_verification_documents" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."company_members" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."service_categories" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."portfolio_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."service_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."request_photos" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."quotes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."quote_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."jobs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."appointments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."conversations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."conversation_members" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."messages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."message_attachments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."reviews" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."payments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."commissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."payouts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."refunds" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."transactions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."financial_adjustments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."notifications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."verification_documents" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."professional_verifications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."professional_verification_documents" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."disputes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."dispute_evidence" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."dispute_messages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."support_tickets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."audit_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."security_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."account_restrictions" ENABLE ROW LEVEL SECURITY;

-- Belt-and-braces: also revoke the default `anon`/`authenticated` grants
-- Supabase applies to every `public` schema table, on the roles PostgREST
-- actually authenticates as. RLS-with-no-policies already denies all
-- access from these roles by itself; this additionally removes the grant
-- so a future policy added by mistake (e.g. `USING (true)`) can't
-- accidentally reopen access without an explicit `GRANT` alongside it.
-- Wrapped in a DO block because these roles only exist on Supabase-hosted
-- Postgres, not a bare local/CI Postgres instance (see .env.example's
-- localhost DATABASE_URL) — this migration must not fail to apply there.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA public FROM authenticated';
  END IF;
END $$;
