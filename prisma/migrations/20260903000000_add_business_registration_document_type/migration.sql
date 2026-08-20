-- Module 74 — Business Registration Enforcement
-- Adds a new value to the existing VerificationDocumentType enum (shared by
-- ProfessionalVerificationDocument and the legacy VerificationDocument
-- model). No new table/enum is introduced — this reuses the Module 17
-- verification-document infrastructure end to end.
--
-- ALTER TYPE ... ADD VALUE cannot run inside the same transaction as a
-- statement that uses the new value, but this migration only adds the
-- value, so it is safe as a single statement.
ALTER TYPE "VerificationDocumentType" ADD VALUE 'BUSINESS_REGISTRATION';
