-- Hand-authored. Module 155 — Chargebacks & Access Revocation, part 1 of 2.
--
-- Adds the DISPUTED value to "LeadPurchaseStatus" and NOTHING else. It is a separate migration on purpose: PostgreSQL does not
-- allow a newly added enum value to be USED (in an index predicate, a CHECK or a trigger body) in the same transaction that
-- adds it, and Prisma applies one migration file as one unit (same reason migration 20260822000000 does it this way).
-- The next migration (20261020000000_add_module_155_lead_fee_disputes) uses the value.
--
-- Purely additive: no row is rewritten or backfilled, no existing constraint/index/trigger is touched. Until the next migration
-- is applied nothing can reach DISPUTED (the application code that writes it ships together with that migration).
--
-- Rollback: PostgreSQL cannot drop an enum value. If it must be undone, recreate the type without DISPUTED ONLY after
-- verifying that no row uses it (SELECT count(*) FROM "lead_purchases" WHERE "status" = 'DISPUTED'), after rolling back the
-- next migration. Leaving the unused value in place is harmless.

ALTER TYPE "LeadPurchaseStatus" ADD VALUE 'DISPUTED';
