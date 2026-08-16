-- Hand-authored (no Postgres/Prisma-engine access in this sandbox to run
-- `prisma migrate dev` and have it generate this file from a real diff —
-- see prisma/migrations/20260822000000_add_job_completion_payment_release_protection/
-- migration.sql, prisma/migrations/20260821000000_add_trust_integrity_system/
-- migration.sql, and prisma/migrations/20260820000000_add_materials_procurement_workflow/
-- migration.sql for the same confirmed precedent in this exact repo). Mirrors
-- what that command would produce for the schema changes below. Run the real
-- command once you have a database locally to double-check, then delete this
-- comment block.
--
-- Module 67 — Trust & Integrity Completion Risk Detection.
--
-- Purely additive: five new values across two existing enums. No new table,
-- no existing table renamed/dropped, no column altered/removed. Reuses the
-- existing FraudSignal / ManualReviewCase / TrustProfile / ScoreEvent tables
-- exactly as they exist today — see MODULE_67_IMPLEMENTATION_REPORT.md,
-- "Database" for why no new model was needed.

-- AlterEnum
-- ALTER TYPE ... ADD VALUE cannot run inside the same transaction as other
-- statements that use the new value on some Postgres versions; `prisma
-- migrate` sequences this automatically. If applying by hand, run this
-- statement ahead of anything that references the new values.
ALTER TYPE "TrustRiskEventReason" ADD VALUE 'PREMATURE_JOB_COMPLETION_DETECTED';
ALTER TYPE "TrustRiskEventReason" ADD VALUE 'JOB_COMPLETION_DISPUTE_CONFLICT_DETECTED';
ALTER TYPE "TrustRiskEventReason" ADD VALUE 'COMPLETION_DURING_ACTIVE_DISPUTE_DETECTED';

-- AlterEnum
ALTER TYPE "FraudSignalType" ADD VALUE 'PREMATURE_JOB_COMPLETION';
ALTER TYPE "FraudSignalType" ADD VALUE 'COMPLETION_DURING_ACTIVE_DISPUTE';
