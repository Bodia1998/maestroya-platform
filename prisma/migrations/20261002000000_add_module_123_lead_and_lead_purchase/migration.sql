-- Hand-authored (same caveat as prior migrations in this repo; the table /
-- index DDL mirrors what Prisma generates for the Module 123 models, the
-- CHECK constraints and the partial unique index cannot be expressed in
-- schema.prisma).
--
-- Module 123 — Lead & LeadPurchase domain and persistence.
--
-- Purely additive: two new enum types and two NEW tables. No existing table
-- or column is altered, dropped, renamed or rewritten; legacy
-- service_requests, quotes, payments, commissions, payouts and invoices are
-- untouched, and every existing ServiceRequest stays valid (a Lead is
-- optional, ServiceRequest 1 --- 0..1 Lead). Foreign keys are ON DELETE
-- RESTRICT (financial/marketplace history must never cascade away).
-- Rollback: DROP TABLE "lead_purchases"; DROP TABLE "leads";
--           DROP TYPE "LeadPurchaseStatus"; DROP TYPE "LeadStatus";

-- CreateEnum
CREATE TYPE "LeadStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'CLOSED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "LeadPurchaseStatus" AS ENUM ('PENDING_PAYMENT', 'CONFIRMED', 'FAILED', 'CANCELLED', 'REFUNDED', 'REVOKED');

-- CreateTable
CREATE TABLE "leads" (
    "id" UUID NOT NULL,
    "serviceRequestId" UUID NOT NULL,
    "status" "LeadStatus" NOT NULL DEFAULT 'DRAFT',
    "maxBuyers" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_purchases" (
    "id" UUID NOT NULL,
    "leadId" UUID NOT NULL,
    "professionalProfileId" UUID NOT NULL,
    "status" "LeadPurchaseStatus" NOT NULL DEFAULT 'PENDING_PAYMENT',
    "price" DECIMAL(10,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "confirmedAt" TIMESTAMP(3),
    "refundedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lead_purchases_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "leads_serviceRequestId_key" ON "leads"("serviceRequestId");

-- CreateIndex
CREATE INDEX "leads_status_createdAt_idx" ON "leads"("status", "createdAt");

-- CreateIndex
CREATE INDEX "lead_purchases_leadId_status_idx" ON "lead_purchases"("leadId", "status");

-- CreateIndex
CREATE INDEX "lead_purchases_professionalProfileId_status_idx" ON "lead_purchases"("professionalProfileId", "status");

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_serviceRequestId_fkey" FOREIGN KEY ("serviceRequestId") REFERENCES "service_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_purchases" ADD CONSTRAINT "lead_purchases_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_purchases" ADD CONSTRAINT "lead_purchases_professionalProfileId_fkey" FOREIGN KEY ("professionalProfileId") REFERENCES "professional_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CHECK constraints (not expressible in Prisma's schema language).
-- NULL maxBuyers = buyer policy not configured yet (unresolved business decision).
ALTER TABLE "leads"
  ADD CONSTRAINT "leads_maxBuyers_positive_check"
  CHECK ("maxBuyers" IS NULL OR "maxBuyers" >= 1);

-- The fee a professional pays MaestroYa can be free (0) but never negative.
ALTER TABLE "lead_purchases"
  ADD CONSTRAINT "lead_purchases_price_nonnegative_check"
  CHECK ("price" >= 0);

-- At most one in-flight-or-paid purchase per professional per lead. This
-- holds under ANY buyer policy (exclusive or shared). Terminal rows
-- (FAILED/CANCELLED/REFUNDED/REVOKED) are excluded so history is kept and a
-- retry after a failed/cancelled attempt is possible. Whether re-purchase
-- after REFUNDED/REVOKED is allowed is a business decision enforced by the
-- later purchase use case, deliberately NOT encoded here. Keep the status
-- list in sync with ACTIVE_LEAD_PURCHASE_STATUSES (domain/services/lead-purchase.ts).
CREATE UNIQUE INDEX "lead_purchases_one_active_per_lead_professional"
  ON "lead_purchases" ("leadId", "professionalProfileId")
  WHERE "status" IN ('PENDING_PAYMENT', 'CONFIRMED');
