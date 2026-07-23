-- Hand-authored (same caveat as every prior migration in this repo: no
-- Postgres/engine access in this environment to run `prisma migrate dev`
-- and have it generate this file from a real diff). Mirrors what that
-- command would produce for the schema changes below. Run the real
-- command once you have a database locally to double-check, then delete
-- this comment block.
--
-- Order / Job Lifecycle module (Module 11): introduces the Job entity —
-- the execution-lifecycle record created automatically when a Quote is
-- accepted (see PrismaQuoteAcceptanceRepository.acceptQuote), sitting
-- between the accepted Quote and its Appointment(s). See the module's own
-- audit report and prisma/schema.prisma's Job model doc comment for the
-- full architectural reasoning (Job vs. reusing ServiceRequest.status,
-- why not "Order"/"WorkOrder", etc).
--
-- This migration:
--   1. Adds JobStatus (CREATED/IN_PROGRESS/COMPLETED/CANCELLED) and
--      JobCancellationReason enums.
--   2. Creates the "jobs" table — 1:1 with the accepted Quote (`quoteId`
--      unique), denormalizing serviceRequestId/customerId/
--      professionalProfileId/companyProfileId at creation time, same
--      "denormalize the frequently-joined FK" pattern already used by
--      Appointment.
--   3. Adds Appointment.jobId. Existing Appointment rows (if any) have no
--      Job to point at yet — this migration backfills exactly one Job per
--      distinct accepted Quote referenced by an existing Appointment (a
--      fresh database has none, but this keeps the migration correct
--      against an environment that already has Booking & Scheduling data,
--      same defensive posture as the
--      20260723010000_add_appointment_scheduling_lifecycle migration's own
--      professionalProfileId/companyProfileId backfill), then makes
--      Appointment.jobId NOT NULL — never left nullable, per the module's
--      backfill-then-require-not-null recommendation.
--
-- Nothing existing is renamed or dropped; no existing row's data changes
-- beyond the backfill described above; no existing FK/index from a prior
-- migration is removed. ServiceRequestStatus/AppointmentStatus enums are
-- untouched by this migration — Module 11 never writes ServiceRequest to
-- IN_PROGRESS/COMPLETED and reuses the Appointment.status COMPLETED value
-- that already exists on the enum (see appointment-state.ts).

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('CREATED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');
CREATE TYPE "JobCancellationReason" AS ENUM ('CUSTOMER_REQUEST', 'PROFESSIONAL_UNABLE_TO_COMPLETE', 'SERVICE_REQUEST_ISSUE', 'OTHER');

-- CreateTable
CREATE TABLE "jobs" (
    "id" UUID NOT NULL,
    "serviceRequestId" UUID NOT NULL,
    "quoteId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "professionalProfileId" UUID,
    "companyProfileId" UUID,
    "status" "JobStatus" NOT NULL DEFAULT 'CREATED',
    "startedAt" TIMESTAMP(3),
    "startedByUserId" UUID,
    "completedAt" TIMESTAMP(3),
    "completedByUserId" UUID,
    "cancelledAt" TIMESTAMP(3),
    "cancelledByUserId" UUID,
    "cancellationReason" "JobCancellationReason",
    "cancellationNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "jobs_quoteId_key" ON "jobs"("quoteId");
CREATE INDEX "jobs_serviceRequestId_idx" ON "jobs"("serviceRequestId");
CREATE INDEX "jobs_customerId_idx" ON "jobs"("customerId");
CREATE INDEX "jobs_professionalProfileId_status_idx" ON "jobs"("professionalProfileId", "status");
CREATE INDEX "jobs_companyProfileId_status_idx" ON "jobs"("companyProfileId", "status");
CREATE INDEX "jobs_status_idx" ON "jobs"("status");

-- AddForeignKey
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_serviceRequestId_fkey" FOREIGN KEY ("serviceRequestId") REFERENCES "service_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "quotes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customer_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_professionalProfileId_fkey" FOREIGN KEY ("professionalProfileId") REFERENCES "professional_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_companyProfileId_fkey" FOREIGN KEY ("companyProfileId") REFERENCES "company_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_startedByUserId_fkey" FOREIGN KEY ("startedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_completedByUserId_fkey" FOREIGN KEY ("completedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_cancelledByUserId_fkey" FOREIGN KEY ("cancelledByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CHECK constraint — cannot be expressed in Prisma's schema language (same
-- "exactly one of professionalProfileId/companyProfileId" pattern already
-- used by quotes_provider_xor_check / appointments_provider_xor_check).
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_provider_xor_check"
  CHECK (num_nonnulls("professionalProfileId", "companyProfileId") = 1);

-- AlterTable: Appointment gains jobId. Added nullable first so the backfill
-- below can populate it for any pre-existing rows, then made NOT NULL —
-- every Appointment created going forward (by
-- PrismaQuoteAcceptanceRepository.acceptQuote or
-- PrismaAppointmentRepository.reschedule) always supplies it.
ALTER TABLE "appointments" ADD COLUMN "jobId" UUID;

-- Backfill: create exactly one Job per distinct Quote already referenced
-- by an existing Appointment (a fresh database has none, but this keeps
-- the migration correct against an environment that already has Booking &
-- Scheduling data — see this migration's header comment). One Job per
-- accepted Quote, denormalizing serviceRequestId/customerId/professional-
-- or company-ProfileId from that Quote/ServiceRequest, status CREATED
-- (existing Appointment rows retain their own independent status —
-- backfilled Jobs start CREATED regardless of how far along their
-- Appointments already are, since there is no reliable prior signal for
-- "was work already started/completed" and CREATED is the conservative,
-- always-valid starting point; operators can reconcile status manually if
-- needed).
INSERT INTO "jobs" ("id", "serviceRequestId", "quoteId", "customerId", "professionalProfileId", "companyProfileId", "status", "createdAt", "updatedAt")
SELECT
  gen_random_uuid(),
  q."serviceRequestId",
  q."id",
  sr."customerId",
  q."professionalProfileId",
  q."companyProfileId",
  'CREATED',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "quotes" q
JOIN "service_requests" sr ON sr."id" = q."serviceRequestId"
WHERE q."id" IN (SELECT DISTINCT "quoteId" FROM "appointments");

-- Point every existing Appointment at the Job backfilled for its own
-- quoteId above.
UPDATE "appointments" AS a
SET "jobId" = j."id"
FROM "jobs" AS j
WHERE a."quoteId" = j."quoteId";

-- Now safe to require — every row (backfilled above, or none on a fresh
-- database) has a jobId.
ALTER TABLE "appointments" ALTER COLUMN "jobId" SET NOT NULL;

-- CreateIndex
CREATE INDEX "appointments_jobId_idx" ON "appointments"("jobId");

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
