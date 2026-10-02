-- Hand-authored (same caveat as prior migrations in this repo).
--
-- Module 121 — Legacy Freeze & Flow Version Boundary.
--
-- Purely additive: one new enum type and one new NOT NULL column WITH a
-- constant default on `service_requests`. On PostgreSQL 11+ adding a column
-- with a constant default is a metadata-only change (no table rewrite), and
-- every existing row reads back as LEGACY_QUOTE_PAYMENT — which is exactly
-- what they are. No table/column is dropped, renamed or altered, and no
-- historical row is rewritten. Rollback: DROP COLUMN "flowVersion"; DROP TYPE.
CREATE TYPE "TransactionFlowVersion" AS ENUM ('LEGACY_QUOTE_PAYMENT', 'LEAD_V1');

ALTER TABLE "service_requests"
  ADD COLUMN "flowVersion" "TransactionFlowVersion" NOT NULL DEFAULT 'LEGACY_QUOTE_PAYMENT';
