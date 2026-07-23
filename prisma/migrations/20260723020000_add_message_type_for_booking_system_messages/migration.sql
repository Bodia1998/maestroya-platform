-- Hand-authored — same caveat as every prior migration in this repo (no
-- Postgres/engine access in this environment). Mirrors what
-- `npx prisma migrate dev` would generate for this schema change.
--
-- Booking & Scheduling module (Module 10), Chat integration: adds a
-- `type` column to Message so the Booking module can post informational
-- "appointment proposed/confirmed/cancelled/rescheduled" notices into an
-- existing Conversation without them being indistinguishable from a
-- normal user-authored chat message. Defaults every existing row to USER
-- (the only kind that has ever existed), so this is purely additive.
--
-- Booking never gains write access to Conversation/Message beyond calling
-- the existing MessageRepository.create (now accepting an optional type) —
-- see application/ports/appointment-notifier.ts. Chat's own schema,
-- persistence, and eligibility rules are untouched.

-- CreateEnum
CREATE TYPE "MessageType" AS ENUM ('USER', 'SYSTEM');

-- AlterTable
ALTER TABLE "messages" ADD COLUMN "type" "MessageType" NOT NULL DEFAULT 'USER';
