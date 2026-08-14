-- Hand-authored (no Postgres/Prisma-engine access in this sandbox to run
-- `prisma migrate dev` and have it generate this file from a real diff —
-- see prisma/migrations/20260820000000_add_materials_procurement_workflow/
-- migration.sql for the same confirmed precedent). Mirrors what that
-- command would produce for the schema changes below. Run the real command
-- once you have a database locally to double-check, then delete this
-- comment block.
--
-- Module 65 — Trust & Integrity System.
--
-- Purely additive: eight new enums, eight new tables, no existing table is
-- renamed, dropped, or has a column altered/removed.

-- 1. Shared cause enum for both score types.
CREATE TYPE "TrustRiskEventReason" AS ENUM (
  'ACCOUNT_VERIFIED',
  'POSITIVE_REVIEW_RECEIVED',
  'JOB_COMPLETED_SUCCESSFULLY',
  'CLEAN_HISTORY_DECAY',
  'OFF_PLATFORM_SIGNAL_DETECTED',
  'FRAUD_SIGNAL_DETECTED',
  'FAKE_REVIEW_PATTERN_DETECTED',
  'SPAM_ACTIVITY_DETECTED',
  'SUSPICIOUS_PRICING_DETECTED',
  'BOOKING_ABUSE_DETECTED',
  'PAYMENT_ABUSE_DETECTED',
  'IDENTITY_RISK_DETECTED',
  'MANUAL_REVIEW_CONFIRMED',
  'APPEAL_APPROVED',
  'ADMIN_ADJUSTMENT'
);

CREATE TYPE "TrustRiskScoreType" AS ENUM ('TRUST', 'RISK');

CREATE TYPE "OffPlatformChannel" AS ENUM (
  'WHATSAPP', 'TELEGRAM', 'SIGNAL', 'PHONE_NUMBER', 'EMAIL_ADDRESS',
  'INSTAGRAM', 'FACEBOOK', 'TIKTOK', 'DISCORD', 'SKYPE',
  'EXTERNAL_PAYMENT_REQUEST', 'CONTACT_EXCHANGE_PHRASE', 'OTHER'
);

CREATE TYPE "FraudSignalType" AS ENUM (
  'MULTIPLE_ACCOUNTS', 'SAME_PHONE', 'SAME_IBAN', 'SAME_STRIPE_ACCOUNT',
  'SAME_DEVICE', 'DUPLICATE_IDENTITY', 'SUSPICIOUS_REGISTRATION_PATTERN',
  'REPEATED_FAILED_VERIFICATION', 'FAKE_REVIEW_PATTERN', 'SPAM_ACTIVITY',
  'SUSPICIOUS_PRICING', 'BOOKING_ABUSE', 'PAYMENT_ABUSE'
);

CREATE TYPE "FraudSignalStatus" AS ENUM ('OPEN', 'REVIEWED', 'DISMISSED', 'CONFIRMED');

CREATE TYPE "TrustAutomatedActionType" AS ENUM (
  'WARNING', 'TEMPORARY_RESTRICTION', 'BOOKING_RESTRICTION',
  'MESSAGING_RESTRICTION', 'PAYOUT_HOLD', 'MANUAL_REVIEW',
  'TEMPORARY_SUSPENSION', 'PERMANENT_SUSPENSION'
);

CREATE TYPE "TrustAutomatedActionStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'REVERSED');

CREATE TYPE "ManualReviewCaseState" AS ENUM ('OPEN', 'UNDER_REVIEW', 'ESCALATED', 'RESOLVED', 'REJECTED');

CREATE TYPE "AppealState" AS ENUM ('SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'ACCOUNT_RESTORED');

-- 2. trust_profiles — one row per user, the current Trust/Risk Score.
CREATE TABLE "trust_profiles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "userId" UUID NOT NULL,
    "trustScore" INTEGER NOT NULL DEFAULT 70,
    "riskScore" INTEGER NOT NULL DEFAULT 0,
    "lastRecalculatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "trust_profiles_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "trust_profiles_userId_key" ON "trust_profiles"("userId");
CREATE INDEX "trust_profiles_trustScore_idx" ON "trust_profiles"("trustScore");
CREATE INDEX "trust_profiles_riskScore_idx" ON "trust_profiles"("riskScore");
ALTER TABLE "trust_profiles" ADD CONSTRAINT "trust_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 3. score_events — append-only audit trail shared by Trust Score and Risk
-- Score changes, distinguished by "scoreType". Replaces what was
-- originally drafted as two structurally-identical tables
-- (trust_score_events / risk_score_events); merged before this migration
-- was ever applied to any database, so this is still a purely additive,
-- zero-downtime change — no rename/backfill of live data is involved.
CREATE TABLE "score_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "trustProfileId" UUID NOT NULL,
    "scoreType" "TrustRiskScoreType" NOT NULL,
    "reason" "TrustRiskEventReason" NOT NULL,
    "delta" INTEGER NOT NULL,
    "scoreBefore" INTEGER NOT NULL,
    "scoreAfter" INTEGER NOT NULL,
    "detail" TEXT NOT NULL,
    "referenceType" TEXT,
    "referenceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "score_events_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "score_events_trustProfileId_idx" ON "score_events"("trustProfileId");
CREATE INDEX "score_events_scoreType_idx" ON "score_events"("scoreType");
CREATE INDEX "score_events_reason_idx" ON "score_events"("reason");
ALTER TABLE "score_events" ADD CONSTRAINT "score_events_trustProfileId_fkey" FOREIGN KEY ("trustProfileId") REFERENCES "trust_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 4. off_platform_detection_events
CREATE TABLE "off_platform_detection_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "userId" UUID NOT NULL,
    "channel" "OffPlatformChannel" NOT NULL,
    "matchedText" VARCHAR(500) NOT NULL,
    "confidence" INTEGER NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "off_platform_detection_events_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "off_platform_detection_events_userId_idx" ON "off_platform_detection_events"("userId");
CREATE INDEX "off_platform_detection_events_channel_idx" ON "off_platform_detection_events"("channel");
CREATE INDEX "off_platform_detection_events_createdAt_idx" ON "off_platform_detection_events"("createdAt");
ALTER TABLE "off_platform_detection_events" ADD CONSTRAINT "off_platform_detection_events_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 5. fraud_signals
CREATE TABLE "fraud_signals" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "userId" UUID NOT NULL,
    "type" "FraudSignalType" NOT NULL,
    "status" "FraudSignalStatus" NOT NULL DEFAULT 'OPEN',
    "detail" TEXT NOT NULL,
    "relatedUserIds" TEXT[],
    "resolvedAt" TIMESTAMP(3),
    "resolvedByUserId" UUID,
    "resolution" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "fraud_signals_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "fraud_signals_userId_idx" ON "fraud_signals"("userId");
CREATE INDEX "fraud_signals_type_idx" ON "fraud_signals"("type");
CREATE INDEX "fraud_signals_status_idx" ON "fraud_signals"("status");
ALTER TABLE "fraud_signals" ADD CONSTRAINT "fraud_signals_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "fraud_signals" ADD CONSTRAINT "fraud_signals_resolvedByUserId_fkey" FOREIGN KEY ("resolvedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 6. trust_automated_actions
CREATE TABLE "trust_automated_actions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "userId" UUID NOT NULL,
    "type" "TrustAutomatedActionType" NOT NULL,
    "status" "TrustAutomatedActionStatus" NOT NULL DEFAULT 'ACTIVE',
    "reason" "TrustRiskEventReason" NOT NULL,
    "triggeringRiskScore" INTEGER NOT NULL,
    "detail" TEXT NOT NULL,
    "createdByUserId" UUID,
    "expiresAt" TIMESTAMP(3),
    "reversedAt" TIMESTAMP(3),
    "reversedByUserId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "trust_automated_actions_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "trust_automated_actions_userId_status_idx" ON "trust_automated_actions"("userId", "status");
CREATE INDEX "trust_automated_actions_type_idx" ON "trust_automated_actions"("type");
CREATE INDEX "trust_automated_actions_expiresAt_idx" ON "trust_automated_actions"("expiresAt");
ALTER TABLE "trust_automated_actions" ADD CONSTRAINT "trust_automated_actions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "trust_automated_actions" ADD CONSTRAINT "trust_automated_actions_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "trust_automated_actions" ADD CONSTRAINT "trust_automated_actions_reversedByUserId_fkey" FOREIGN KEY ("reversedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 7. trust_manual_review_cases
CREATE TABLE "trust_manual_review_cases" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "userId" UUID NOT NULL,
    "state" "ManualReviewCaseState" NOT NULL DEFAULT 'OPEN',
    "reason" "TrustRiskEventReason" NOT NULL,
    "summary" TEXT NOT NULL,
    "assignedAdminId" UUID,
    "resolvedAt" TIMESTAMP(3),
    "resolvedByUserId" UUID,
    "resolutionNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "trust_manual_review_cases_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "trust_manual_review_cases_userId_idx" ON "trust_manual_review_cases"("userId");
CREATE INDEX "trust_manual_review_cases_state_idx" ON "trust_manual_review_cases"("state");
ALTER TABLE "trust_manual_review_cases" ADD CONSTRAINT "trust_manual_review_cases_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "trust_manual_review_cases" ADD CONSTRAINT "trust_manual_review_cases_assignedAdminId_fkey" FOREIGN KEY ("assignedAdminId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "trust_manual_review_cases" ADD CONSTRAINT "trust_manual_review_cases_resolvedByUserId_fkey" FOREIGN KEY ("resolvedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 8. trust_appeals
CREATE TABLE "trust_appeals" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "userId" UUID NOT NULL,
    "automatedActionId" UUID NOT NULL,
    "state" "AppealState" NOT NULL DEFAULT 'SUBMITTED',
    "userStatement" TEXT NOT NULL,
    "reviewedAt" TIMESTAMP(3),
    "reviewedByUserId" UUID,
    "reviewNotes" TEXT,
    "restoredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "trust_appeals_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "trust_appeals_userId_idx" ON "trust_appeals"("userId");
CREATE INDEX "trust_appeals_automatedActionId_idx" ON "trust_appeals"("automatedActionId");
CREATE INDEX "trust_appeals_state_idx" ON "trust_appeals"("state");
ALTER TABLE "trust_appeals" ADD CONSTRAINT "trust_appeals_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "trust_appeals" ADD CONSTRAINT "trust_appeals_automatedActionId_fkey" FOREIGN KEY ("automatedActionId") REFERENCES "trust_automated_actions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "trust_appeals" ADD CONSTRAINT "trust_appeals_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
