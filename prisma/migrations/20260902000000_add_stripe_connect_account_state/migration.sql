-- Hand-authored (no Postgres/Prisma-engine access in this sandbox to run
-- `prisma migrate dev` and have it generate this file from a real diff —
-- see prisma/migrations/20260901000000_add_external_webhook_event_idempotency/
-- migration.sql for the same confirmed precedent). Mirrors what that
-- command would produce for the schema change below. Run the real command
-- once you have a database locally to double-check, then delete this
-- comment block.
--
-- Module 71 — Stripe Connect: five new, purely additive, nullable/defaulted
-- columns on the existing "professional_payout_accounts" table. No
-- existing table is renamed, dropped, or has a column removed. No
-- existing row needs a backfill — every new column defaults to its
-- "no connected account yet" value, which is exactly correct for every
-- row that already exists.

-- AlterTable
ALTER TABLE "professional_payout_accounts"
  ADD COLUMN "stripeChargesEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "stripePayoutsEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "stripeDetailsSubmitted" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "stripeRequirementsCurrentlyDue" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "stripeConnectSyncedAt" TIMESTAMP(3);
