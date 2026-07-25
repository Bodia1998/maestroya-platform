-- Hand-authored (same caveat as every prior migration in this repo: no
-- Postgres/engine access in this environment to run `prisma migrate dev` and
-- have it generate this file from a real diff — see
-- docs/MODULE_19_SEARCH_RANKING.md / docs/MODULE_20_MAPS_GEOLOCATION.md,
-- "Validation Results", for the same confirmed precedent). Mirrors what that
-- command would produce for the schema changes below. Run the real command
-- once you have a database locally to double-check.
--
-- Module 21 — Disputes & Support.
--
-- This migration:
--   1. Reconciles the three enums scaffolded (but never used by application
--      code) by Module 01 — DisputeReason, DisputeStatus, DisputeResolution —
--      toward the vocabulary this module's spec asks for. Every ALTER TYPE
--      below assumes the "disputes" table has zero rows (true today: no
--      application code has ever written to it), so recreating DisputeStatus
--      with fewer values (AWAITING_RESPONSE/ESCALATED removed) and adding new
--      columns as NOT NULL is safe without a backfill. If this migration is
--      ever applied to an environment where that assumption doesn't hold, the
--      DisputeStatus rebuild's USING clause and the new NOT NULL columns must
--      be revisited with a real backfill first.
--   2. Adds Dispute.jobId (Restrict-anchored to Job — see schema.prisma's
--      Dispute doc comment for why Job, not just ServiceRequest, is now the
--      primary anchor) plus caseNumber/title/priority/assignedAdminUserId/
--      resolutionNote/closedAt/closedByUserId.
--   3. Extends DisputeEvidence with fileName/fileType/fileSizeBytes, mirroring
--      MessageAttachment's metadata fields.
--   4. Adds the DisputeMessage table (dispute thread + internal notes, see
--      schema.prisma's doc comment for why this is a dedicated table rather
--      than reusing Conversation/Message).
--   5. Adds the SupportTicket table + its two new enums (general,
--      non-order-tied support issues — kept separate from Dispute, see
--      schema.prisma's SupportTicketCategory doc comment).
--   6. Adds 13 new NotificationType values for Dispute/SupportTicket events.
--   7. Adds a partial unique index enforcing "at most one OPEN dispute per
--      (job, opener)" — see schema.prisma's Dispute doc comment.
--
-- Nothing existing outside the three reconciled enums and the "disputes"/
-- "dispute_evidence" tables is touched.

-- ============================================================================
-- 1a. DisputeReason — rename in place, add three new values.
-- ============================================================================
ALTER TYPE "DisputeReason" RENAME VALUE 'QUALITY_ISSUE' TO 'SERVICE_QUALITY';
ALTER TYPE "DisputeReason" RENAME VALUE 'DAMAGE_CLAIM' TO 'PROPERTY_DAMAGE';
ALTER TYPE "DisputeReason" RENAME VALUE 'BILLING_ISSUE' TO 'PRICE_DISAGREEMENT';
ALTER TYPE "DisputeReason" RENAME VALUE 'BEHAVIOR_ISSUE' TO 'COMMUNICATION_ISSUE';
ALTER TYPE "DisputeReason" ADD VALUE 'PROFESSIONAL_NO_SHOW';
ALTER TYPE "DisputeReason" ADD VALUE 'CUSTOMER_NO_SHOW';
ALTER TYPE "DisputeReason" ADD VALUE 'SCOPE_OF_WORK';

-- ============================================================================
-- 1b. DisputeStatus — rebuilt (values removed, not just renamed/added, which
-- Postgres requires a new-type-swap for). Assumes zero existing rows (see
-- this file's top doc comment).
-- ============================================================================
CREATE TYPE "DisputeStatus_new" AS ENUM (
    'OPEN',
    'UNDER_REVIEW',
    'WAITING_FOR_CUSTOMER',
    'WAITING_FOR_PROFESSIONAL',
    'RESOLVED',
    'REJECTED',
    'CLOSED'
);

ALTER TABLE "disputes" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "disputes" ALTER COLUMN "status" TYPE "DisputeStatus_new"
    USING (
        CASE "status"::text
            WHEN 'AWAITING_RESPONSE' THEN 'WAITING_FOR_CUSTOMER'
            WHEN 'ESCALATED' THEN 'CLOSED'
            ELSE "status"::text
        END
    )::"DisputeStatus_new";
DROP TYPE "DisputeStatus";
ALTER TYPE "DisputeStatus_new" RENAME TO "DisputeStatus";
ALTER TABLE "disputes" ALTER COLUMN "status" SET DEFAULT 'OPEN';

-- ============================================================================
-- 1c. DisputeResolution — rename payment-action vocabulary to business-
-- outcome vocabulary, add FINANCIAL_ADJUSTMENT_REQUIRED.
-- ============================================================================
ALTER TYPE "DisputeResolution" RENAME VALUE 'REFUND_CUSTOMER' TO 'CUSTOMER_FAVOR';
ALTER TYPE "DisputeResolution" RENAME VALUE 'PAY_PROFESSIONAL' TO 'PROFESSIONAL_FAVOR';
ALTER TYPE "DisputeResolution" RENAME VALUE 'PARTIAL_REFUND' TO 'PARTIAL_RESOLUTION';
ALTER TYPE "DisputeResolution" ADD VALUE 'FINANCIAL_ADJUSTMENT_REQUIRED';

-- ============================================================================
-- 2. New enums used by Dispute/SupportTicket.
-- ============================================================================
CREATE TYPE "DisputePriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');

CREATE TYPE "SupportTicketCategory" AS ENUM ('ACCOUNT', 'VERIFICATION', 'BUG', 'LOGIN', 'GENERAL', 'OTHER');

CREATE TYPE "SupportTicketStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'WAITING_FOR_USER', 'RESOLVED', 'CLOSED');

-- ============================================================================
-- 3. New NotificationType values.
-- ============================================================================
ALTER TYPE "NotificationType" ADD VALUE 'DISPUTE_CREATED';
ALTER TYPE "NotificationType" ADD VALUE 'DISPUTE_ASSIGNED';
ALTER TYPE "NotificationType" ADD VALUE 'DISPUTE_STATUS_CHANGED';
ALTER TYPE "NotificationType" ADD VALUE 'DISPUTE_RESPONSE_REQUESTED';
ALTER TYPE "NotificationType" ADD VALUE 'DISPUTE_RESOLVED';
ALTER TYPE "NotificationType" ADD VALUE 'DISPUTE_REJECTED';
ALTER TYPE "NotificationType" ADD VALUE 'DISPUTE_CLOSED';
ALTER TYPE "NotificationType" ADD VALUE 'SUPPORT_TICKET_CREATED';
ALTER TYPE "NotificationType" ADD VALUE 'SUPPORT_TICKET_ASSIGNED';
ALTER TYPE "NotificationType" ADD VALUE 'SUPPORT_TICKET_STATUS_CHANGED';
ALTER TYPE "NotificationType" ADD VALUE 'SUPPORT_TICKET_RESOLVED';
ALTER TYPE "NotificationType" ADD VALUE 'SUPPORT_TICKET_CLOSED';

-- ============================================================================
-- 4. Alter "disputes": new columns.
-- ============================================================================
ALTER TABLE "disputes"
    ADD COLUMN "caseNumber" TEXT NOT NULL,
    ADD COLUMN "title" TEXT NOT NULL,
    ADD COLUMN "jobId" UUID NOT NULL,
    ADD COLUMN "priority" "DisputePriority" NOT NULL DEFAULT 'MEDIUM',
    ADD COLUMN "assignedAdminUserId" UUID,
    ADD COLUMN "resolutionNote" TEXT,
    ADD COLUMN "closedAt" TIMESTAMP(3),
    ADD COLUMN "closedByUserId" UUID;

CREATE UNIQUE INDEX "disputes_caseNumber_key" ON "disputes"("caseNumber");
CREATE INDEX "disputes_jobId_idx" ON "disputes"("jobId");
CREATE INDEX "disputes_assignedAdminUserId_idx" ON "disputes"("assignedAdminUserId");
CREATE INDEX "disputes_priority_idx" ON "disputes"("priority");

-- Partial unique index: at most one OPEN dispute per (job, opener) — the
-- "same user can't open a second concurrently-open case on the same Job"
-- invariant. Not expressible in Prisma's schema language, hence hand-added
-- here (same pattern as professional_verifications_active_unique in
-- 20260729000000_add_professional_verification_module).
CREATE UNIQUE INDEX "disputes_open_per_job_per_opener_unique"
    ON "disputes"("jobId", "raisedByUserId")
    WHERE "status" = 'OPEN';

ALTER TABLE "disputes"
    ADD CONSTRAINT "disputes_jobId_fkey"
    FOREIGN KEY ("jobId") REFERENCES "jobs"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "disputes"
    ADD CONSTRAINT "disputes_assignedAdminUserId_fkey"
    FOREIGN KEY ("assignedAdminUserId") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "disputes"
    ADD CONSTRAINT "disputes_closedByUserId_fkey"
    FOREIGN KEY ("closedByUserId") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================================================================
-- 5. Alter "dispute_evidence": attachment metadata columns.
-- ============================================================================
ALTER TABLE "dispute_evidence"
    ADD COLUMN "fileName" TEXT,
    ADD COLUMN "fileType" TEXT,
    ADD COLUMN "fileSizeBytes" INTEGER;

-- ============================================================================
-- 6. New table: dispute_messages.
-- ============================================================================
CREATE TABLE "dispute_messages" (
    "id" UUID NOT NULL,
    "disputeId" UUID NOT NULL,
    "authorUserId" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "isInternalNote" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dispute_messages_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "dispute_messages_disputeId_isInternalNote_createdAt_idx"
    ON "dispute_messages"("disputeId", "isInternalNote", "createdAt");
CREATE INDEX "dispute_messages_authorUserId_idx" ON "dispute_messages"("authorUserId");

ALTER TABLE "dispute_messages"
    ADD CONSTRAINT "dispute_messages_disputeId_fkey"
    FOREIGN KEY ("disputeId") REFERENCES "disputes"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "dispute_messages"
    ADD CONSTRAINT "dispute_messages_authorUserId_fkey"
    FOREIGN KEY ("authorUserId") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================================
-- 7. New table: support_tickets.
-- ============================================================================
CREATE TABLE "support_tickets" (
    "id" UUID NOT NULL,
    "ticketNumber" TEXT NOT NULL,
    "category" "SupportTicketCategory" NOT NULL,
    "subject" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" "SupportTicketStatus" NOT NULL DEFAULT 'OPEN',
    "priority" "DisputePriority" NOT NULL DEFAULT 'MEDIUM',
    "openedByUserId" UUID NOT NULL,
    "assignedAdminUserId" UUID,
    "resolutionNote" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolvedByUserId" UUID,
    "closedAt" TIMESTAMP(3),
    "closedByUserId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "support_tickets_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "support_tickets_ticketNumber_key" ON "support_tickets"("ticketNumber");
CREATE INDEX "support_tickets_openedByUserId_idx" ON "support_tickets"("openedByUserId");
CREATE INDEX "support_tickets_assignedAdminUserId_idx" ON "support_tickets"("assignedAdminUserId");
CREATE INDEX "support_tickets_status_idx" ON "support_tickets"("status");
CREATE INDEX "support_tickets_priority_idx" ON "support_tickets"("priority");

ALTER TABLE "support_tickets"
    ADD CONSTRAINT "support_tickets_openedByUserId_fkey"
    FOREIGN KEY ("openedByUserId") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "support_tickets"
    ADD CONSTRAINT "support_tickets_assignedAdminUserId_fkey"
    FOREIGN KEY ("assignedAdminUserId") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "support_tickets"
    ADD CONSTRAINT "support_tickets_resolvedByUserId_fkey"
    FOREIGN KEY ("resolvedByUserId") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "support_tickets"
    ADD CONSTRAINT "support_tickets_closedByUserId_fkey"
    FOREIGN KEY ("closedByUserId") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
