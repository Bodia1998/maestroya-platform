-- Module 96 — Referral & Affiliate Production Wiring.
--
-- DB-level idempotency guard for ConversionEvent.referenceId, scoped per
-- type — the ultimate backstop against a duplicate/redelivered domain
-- event creating two conversions for the same underlying booking/payment/
-- commission, never only an application-level pre-check. Postgres treats
-- NULL as distinct in a unique index, so this is additive/safe even
-- though referenceId is nullable and most historical rows (if any —
-- this table has no live production writer as of this migration) may
-- have it unset.
CREATE UNIQUE INDEX "conversion_events_type_referenceId_key"
  ON "conversion_events" ("type", "referenceId");
