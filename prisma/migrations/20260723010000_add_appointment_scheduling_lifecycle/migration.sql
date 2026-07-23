-- Hand-authored (same caveat as every prior migration in this repo: no
-- Postgres/engine access in this environment to run `prisma migrate dev`
-- and have it generate this file from a real diff). Mirrors what that
-- command would produce for the schema changes below. Run the real
-- command once you have a database locally to double-check, then delete
-- this comment block.
--
-- Booking & Scheduling module (Module 10): extends the Appointment
-- lifecycle that begins with the existing Quote-acceptance workflow
-- (Appointment created as PENDING_SCHEDULE — see
-- 20260723000000_add_appointment_pending_schedule). This migration adds
-- everything the propose/confirm/reschedule/cancel workflow needs:
--
--   1. AppointmentStatus gains PROPOSED (an unconfirmed time put forward by
--      either party — see domain/services/appointment-state.ts). SCHEDULED
--      remains on the enum for backward compatibility but is superseded
--      and never written by any code.
--
--   2. A new AppointmentCancellationReason enum, replacing the previously
--      unused free-text `cancellationReason` column, so a future refund
--      workflow can automate off it instead of parsing prose. No existing
--      row has ever had this column set (confirmed by the audit — no code
--      path writes it), so this is a safe type change requiring no data
--      backfill for this specific column.
--
--   3. Appointment gains professionalProfileId/companyProfileId — the
--      single biggest structural gap identified by the audit: without a
--      direct provider FK, "does this professional have a conflicting
--      appointment" required a two-hop join through Quote with no
--      supporting index. Backfilled below from each existing Appointment's
--      own Quote, then protected going forward by the same "exactly one"
--      CHECK constraint pattern already used for
--      Quote/Review/Payout/VerificationDocument/Dispute.
--
--   4. Appointment gains proposedStart/proposedEnd/proposedByUserId (the
--      propose-then-confirm negotiation state), cancelledByUserId +
--      cancellationNote (cancellation metadata), and rescheduledFromId (a
--      self-referencing, non-destructive reschedule link — see
--      RescheduleAppointmentUseCase).
--
--   5. scheduledStart/scheduledEnd/proposedStart/proposedEnd/actualStart/
--      actualEnd/cancelledAt move from this schema's default
--      timezone-naive TIMESTAMP(3) to TIMESTAMPTZ(3) — a true UTC instant.
--      This is scoped to Appointment only, not a platform-wide migration
--      (see schema.prisma's doc comment on Appointment.scheduledStart for
--      the full reasoning); every other DateTime column in the schema is
--      left untouched.
--
--   6. AppointmentStatus's schema-level default is corrected from the
--      stale SCHEDULED to PENDING_SCHEDULE, matching what
--      PrismaQuoteAcceptanceRepository has always actually written — this
--      was purely a schema-level footgun (a misleading default an
--      out-of-band INSERT could have silently relied on); the application
--      itself never depended on the old default.
--
--   7. Composite indexes on (professionalProfileId|companyProfileId,
--      status, scheduledStart, scheduledEnd) supporting the conflict query
--      ConfirmAppointmentUseCase runs before writing CONFIRMED.
--
-- Nothing existing is renamed or dropped; no existing row's `status` value
-- changes; no existing FK/index from the prior migration is removed.
--
-- Deliberately NOT included in this migration (see the audit's Phase 3
-- "CAN BE DEFERRED" section, and the implementation plan for this module):
-- a `btree_gist` EXCLUDE constraint for DB-level overlap prevention. This
-- module relies on the application-level conflict check plus a
-- transaction-level re-check inside ConfirmAppointmentUseCase's Prisma
-- interactive transaction (same pattern as
-- PrismaQuoteAcceptanceRepository's conditional-updateMany race guard) —
-- see that use case's doc comment for the full reasoning and the
-- documented limitation.

-- CreateEnum
CREATE TYPE "AppointmentCancellationReason" AS ENUM ('CUSTOMER_REQUEST', 'PROFESSIONAL_UNAVAILABLE', 'SCHEDULING_CONFLICT', 'OTHER');

-- AlterEnum
ALTER TYPE "AppointmentStatus" ADD VALUE 'PROPOSED';

-- AlterTable: convert the existing, always-null, free-text
-- cancellationReason column to the new typed enum (see note 2 above).
ALTER TABLE "appointments" ALTER COLUMN "cancellationReason" TYPE "AppointmentCancellationReason" USING (NULL);

-- AlterTable: new ownership, proposal, cancellation-metadata, and
-- reschedule-link columns.
ALTER TABLE "appointments"
  ADD COLUMN "professionalProfileId" UUID,
  ADD COLUMN "companyProfileId" UUID,
  ADD COLUMN "proposedStart" TIMESTAMPTZ(3),
  ADD COLUMN "proposedEnd" TIMESTAMPTZ(3),
  ADD COLUMN "proposedByUserId" UUID,
  ADD COLUMN "cancelledByUserId" UUID,
  ADD COLUMN "cancellationNote" TEXT,
  ADD COLUMN "rescheduledFromId" UUID;

-- AlterTable: scheduling-relevant timestamps become TIMESTAMPTZ(3) — see
-- note 5 above and schema.prisma's Appointment.scheduledStart doc comment.
ALTER TABLE "appointments" ALTER COLUMN "scheduledStart" TYPE TIMESTAMPTZ(3);
ALTER TABLE "appointments" ALTER COLUMN "scheduledEnd" TYPE TIMESTAMPTZ(3);
ALTER TABLE "appointments" ALTER COLUMN "actualStart" TYPE TIMESTAMPTZ(3);
ALTER TABLE "appointments" ALTER COLUMN "actualEnd" TYPE TIMESTAMPTZ(3);
ALTER TABLE "appointments" ALTER COLUMN "cancelledAt" TYPE TIMESTAMPTZ(3);

-- AlterTable: correct the stale default (see note 6 above).
ALTER TABLE "appointments" ALTER COLUMN "status" SET DEFAULT 'PENDING_SCHEDULE';

-- Backfill professionalProfileId/companyProfileId for any pre-existing
-- Appointment rows from their own Quote (a fresh database has none, but
-- this keeps the migration correct against an environment that already
-- has data from the booking-appointments module).
UPDATE "appointments" AS a
SET "professionalProfileId" = q."professionalProfileId",
    "companyProfileId" = q."companyProfileId"
FROM "quotes" AS q
WHERE a."quoteId" = q."id";

-- CreateIndex
CREATE INDEX "appointments_professionalProfileId_status_scheduledStart_scheduledEnd_idx" ON "appointments"("professionalProfileId", "status", "scheduledStart", "scheduledEnd");
CREATE INDEX "appointments_companyProfileId_status_scheduledStart_scheduledEnd_idx" ON "appointments"("companyProfileId", "status", "scheduledStart", "scheduledEnd");

-- CreateIndex (unique — a superseded appointment can be rescheduled into
-- at most one successor)
CREATE UNIQUE INDEX "appointments_rescheduledFromId_key" ON "appointments"("rescheduledFromId");

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_professionalProfileId_fkey" FOREIGN KEY ("professionalProfileId") REFERENCES "professional_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_companyProfileId_fkey" FOREIGN KEY ("companyProfileId") REFERENCES "company_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_proposedByUserId_fkey" FOREIGN KEY ("proposedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_cancelledByUserId_fkey" FOREIGN KEY ("cancelledByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_rescheduledFromId_fkey" FOREIGN KEY ("rescheduledFromId") REFERENCES "appointments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CHECK constraints — cannot be expressed in Prisma's schema language (same
-- pattern as quotes_provider_xor_check etc. in the init migration).
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_provider_xor_check"
  CHECK (num_nonnulls("professionalProfileId", "companyProfileId") = 1);

ALTER TABLE "appointments" ADD CONSTRAINT "appointments_schedule_order_check"
  CHECK ("scheduledEnd" IS NULL OR "scheduledStart" IS NULL OR "scheduledEnd" > "scheduledStart");

ALTER TABLE "appointments" ADD CONSTRAINT "appointments_proposal_order_check"
  CHECK ("proposedEnd" IS NULL OR "proposedStart" IS NULL OR "proposedEnd" > "proposedStart");
