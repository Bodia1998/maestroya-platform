-- Hand-authored (no Postgres/Prisma-engine access in this sandbox to run
-- `prisma migrate dev` and have it generate this file from a real diff —
-- see prisma/migrations/20260825000000_add_refund_boundedness_guard/
-- migration.sql and prior migrations for the same confirmed precedent).
-- Mirrors what that command would produce for the schema change below.
-- Run the real command once you have a database locally to double-check,
-- then delete this comment block.
--
-- Module 70.1 — Pre-Stripe Security & Integration Hardening (Objective C):
-- a single new, purely additive table — the provider-independent
-- external-event idempotency ledger. No existing table is renamed,
-- dropped, or has a column altered/removed. No existing row is rewritten.

-- ============================================================================
-- Enums
-- ============================================================================

-- CreateEnum
CREATE TYPE "ExternalWebhookEventStatus" AS ENUM (
  'PROCESSING',
  'PROCESSED',
  'FAILED'
);

-- ============================================================================
-- external_webhook_events
-- ============================================================================

-- CreateTable
-- The DB-enforced uniqueness invariant is ("provider", "externalEventId")
-- below — see ExternalWebhookEventRepository's own doc comment for why
-- this table's whole purpose depends on that being a real database
-- constraint, not just an application-level check.
CREATE TABLE "external_webhook_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "provider" VARCHAR(40) NOT NULL,
    "externalEventId" VARCHAR(191) NOT NULL,
    "eventType" VARCHAR(100),
    "status" "ExternalWebhookEventStatus" NOT NULL DEFAULT 'PROCESSING',
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "external_webhook_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "external_webhook_events_provider_externalEventId_key" ON "external_webhook_events"("provider", "externalEventId");
CREATE INDEX "external_webhook_events_provider_status_idx" ON "external_webhook_events"("provider", "status");
