-- Hand-authored (same caveat as every prior migration in this repo: no
-- Postgres/engine access in this environment to run `prisma migrate dev` and
-- have it generate this file from a real diff). Mirrors what that command
-- would produce for the schema change below. Run the real command once you
-- have a database locally to double-check.
--
-- Module 28 — Workflow Completion: adds four new NotificationType values for
-- the daily expiration cron (ServiceRequest/Quote/ProfessionalVerification/
-- CompanyVerification auto-expiry — see
-- docs/MODULE_28_WORKFLOW_COMPLETION.md). No table changes: `expiresAt` on
-- ServiceRequest, `validUntil` on Quote, and `expiresAt` on
-- ProfessionalVerification/CompanyVerification all already exist on the
-- schema from earlier modules and were simply never automatically enforced
-- until now — see this module's ExpireServiceRequestsUseCase /
-- ExpireQuotesUseCase / ExpireProfessionalVerificationsUseCase /
-- ExpireCompanyVerificationsUseCase. Naming mirrors the existing
-- VERIFICATION_*/COMPANY_VERIFICATION_* split introduced by the Module
-- 17/29 and Module 18/30 migrations rather than inventing a combined
-- "PROFESSIONAL_VERIFICATION_EXPIRED" value.

-- AlterEnum
-- ALTER TYPE ... ADD VALUE cannot run inside a transaction block on older
-- Postgres; `prisma migrate` handles this automatically. If applying by hand
-- on such a version, run these outside a transaction.
ALTER TYPE "NotificationType" ADD VALUE 'SERVICE_REQUEST_EXPIRED';
ALTER TYPE "NotificationType" ADD VALUE 'QUOTE_EXPIRED';
ALTER TYPE "NotificationType" ADD VALUE 'VERIFICATION_EXPIRED';
ALTER TYPE "NotificationType" ADD VALUE 'COMPANY_VERIFICATION_EXPIRED';
