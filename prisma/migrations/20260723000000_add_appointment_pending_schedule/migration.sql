-- Same caveat as every prior migration in this repo: hand-authored to
-- mirror what `npx prisma migrate dev` would generate, not engine-verified
-- (no network access in this environment). Run the real command once you
-- have this locally.
--
-- Booking/Appointments Module: the existing Appointment model (added in the
-- initial domain model) assumed scheduling always happens at booking time —
-- `scheduledStart` was NOT NULL with no default, and `AppointmentStatus` had
-- no "created but not yet scheduled" state. This module's MVP flow creates
-- an Appointment the moment a Quote is accepted, before any real scheduling
-- (out of scope here — see the module's scope note), so neither assumption
-- held. This migration makes the minimal additive change needed:
--   1. `AppointmentStatus` gains PENDING_SCHEDULE, the initial status for an
--      Appointment created by Quote acceptance.
--   2. `scheduledStart` becomes nullable, left null until a future
--      scheduling module fills it in.
-- Nothing existing is renamed, dropped, or made backward-incompatible.

-- AlterEnum
ALTER TYPE "AppointmentStatus" ADD VALUE 'PENDING_SCHEDULE';

-- AlterTable
ALTER TABLE "appointments" ALTER COLUMN "scheduledStart" DROP NOT NULL;
