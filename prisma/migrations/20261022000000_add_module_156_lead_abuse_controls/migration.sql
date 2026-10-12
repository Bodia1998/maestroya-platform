-- Hand-authored (same caveat as prior migrations: table/index DDL mirrors what Prisma generates;
-- CHECK constraints, partial indexes and triggers cannot be expressed in schema.prisma).
--
-- Module 156 — Lead Marketplace Fraud & Abuse Controls.
--
-- PURELY ADDITIVE: two new tables, their enums, indexes, CHECKs and triggers. No existing table, column, index, trigger, enum
-- or row is changed (the Prisma relation field added to User has no database column; the only foreign key points from the new
-- signals table to "users"). Nothing here touches purchases, disputes, revocations, refunds, ledger, invoices or credit notes.
--
--   1. "lead_abuse_signals": append-only evidence. Either a RULE HIT (counted facts, threshold, window) or a raw EVENT (a probed
--      lead). UNIQUE "dedupeKey" is the idempotency key: recording the same signal twice inserts one row. Never updated, never
--      deleted (trigger). The signal carries ids and counts only — no contact data, no free text.
--   2. "lead_abuse_decisions": the enforcement record. FLAG_FOR_REVIEW (restricts nothing) or TEMPORARY_BLOCK of ONE named action.
--      Every block MUST expire (CHECK): automated blocks within 24 h, administrator blocks within 30 days — there is no
--      permanent block. At most ONE ACTIVE flag and ONE ACTIVE block per (subject, action) (partial unique indexes), so racing
--      writers converge on one row. Identity / decision columns are immutable; status moves ACTIVE -> LIFTED | EXPIRED only (both
--      terminal); LIFTED needs an administrator and a note. Rows are never deleted.
--   3. Automated rows carry no human actor and a rule key; administrator rows carry the acting administrator and an explanation.
--
-- Rollback (manual; the tables hold only M156 data, nothing else references them):
--   DROP TABLE "lead_abuse_decisions"; DROP TABLE "lead_abuse_signals";
--   DROP FUNCTION lead_abuse_decisions_guard_update(); DROP FUNCTION lead_abuse_no_delete(); DROP FUNCTION lead_abuse_signals_append_only();
--   DROP TYPE "LeadAbuseDecisionOrigin"; DROP TYPE "LeadAbuseDecisionStatus"; DROP TYPE "LeadAbuseRestrictedAction";
--   DROP TYPE "LeadAbuseDecisionAction"; DROP TYPE "LeadAbuseSeverity"; DROP TYPE "LeadAbuseSignalReliability"; DROP TYPE "LeadAbuseSignalType";

-- CreateEnum
CREATE TYPE "LeadAbuseSignalType" AS ENUM (
    'PUBLICATION_BURST',
    'DUPLICATE_REQUEST_CONTENT',
    'PURCHASE_INITIATION_BURST',
    'PURCHASE_REJECTED_PROBING',
    'CONTACT_ACCESS_DENIED_PROBING',
    'REPEATED_DISPUTES_OPENED',
    'REPEATED_DISPUTES_LOST',
    'REPEATED_REVOCATIONS',
    'PURCHASE_REJECTED_EVENT',
    'CONTACT_ACCESS_DENIED_EVENT'
);
CREATE TYPE "LeadAbuseSignalReliability" AS ENUM ('RELIABLE', 'HEURISTIC');
CREATE TYPE "LeadAbuseSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH');
CREATE TYPE "LeadAbuseDecisionAction" AS ENUM ('FLAG_FOR_REVIEW', 'TEMPORARY_BLOCK');
CREATE TYPE "LeadAbuseRestrictedAction" AS ENUM ('LEAD_PUBLICATION', 'LEAD_PURCHASE_INITIATION');
CREATE TYPE "LeadAbuseDecisionStatus" AS ENUM ('ACTIVE', 'LIFTED', 'EXPIRED');
CREATE TYPE "LeadAbuseDecisionOrigin" AS ENUM ('AUTOMATED', 'ADMIN');

-- CreateTable
CREATE TABLE "lead_abuse_signals" (
    "id" UUID NOT NULL,
    "subjectUserId" UUID NOT NULL,
    "signalType" "LeadAbuseSignalType" NOT NULL,
    "reliability" "LeadAbuseSignalReliability" NOT NULL,
    "severity" "LeadAbuseSeverity" NOT NULL,
    "ruleVersion" VARCHAR(32) NOT NULL,
    "dedupeKey" VARCHAR(200) NOT NULL,
    "targetLeadId" UUID,
    "observedCount" INTEGER,
    "threshold" INTEGER,
    "windowSeconds" INTEGER,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_abuse_signals_pkey" PRIMARY KEY ("id"),
    -- a raw event names the probed lead and has no counters; a rule hit has counters and names no lead
    CONSTRAINT "lead_abuse_signals_shape_check" CHECK (
        (
            "signalType" IN ('PURCHASE_REJECTED_EVENT', 'CONTACT_ACCESS_DENIED_EVENT')
            AND "targetLeadId" IS NOT NULL AND "observedCount" IS NULL AND "threshold" IS NULL AND "windowSeconds" IS NULL
        ) OR (
            "signalType" NOT IN ('PURCHASE_REJECTED_EVENT', 'CONTACT_ACCESS_DENIED_EVENT')
            AND "targetLeadId" IS NULL AND "observedCount" IS NOT NULL AND "threshold" IS NOT NULL AND "windowSeconds" IS NOT NULL
        )
    ),
    CONSTRAINT "lead_abuse_signals_counts_check" CHECK (
        ("observedCount" IS NULL OR "observedCount" >= 0)
        AND ("threshold" IS NULL OR "threshold" > 0)
        AND ("windowSeconds" IS NULL OR "windowSeconds" > 0)
    ),
    CONSTRAINT "lead_abuse_signals_dedupe_key_check" CHECK (length("dedupeKey") BETWEEN 1 AND 200)
);

CREATE TABLE "lead_abuse_decisions" (
    "id" UUID NOT NULL,
    "subjectUserId" UUID NOT NULL,
    "action" "LeadAbuseDecisionAction" NOT NULL,
    "restrictedAction" "LeadAbuseRestrictedAction",
    "status" "LeadAbuseDecisionStatus" NOT NULL DEFAULT 'ACTIVE',
    "origin" "LeadAbuseDecisionOrigin" NOT NULL,
    "ruleKey" "LeadAbuseSignalType",
    "ruleVersion" VARCHAR(32),
    "reasonCode" VARCHAR(64) NOT NULL,
    "createdByUserId" UUID,
    "decidedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "explanation" VARCHAR(500),
    "liftedAt" TIMESTAMP(3),
    "liftedByUserId" UUID,
    "resolutionNote" VARCHAR(500),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lead_abuse_decisions_pkey" PRIMARY KEY ("id"),
    -- a block names the action it restricts; a flag restricts nothing
    CONSTRAINT "lead_abuse_decisions_action_shape_check" CHECK (
        ("action" = 'TEMPORARY_BLOCK') = ("restrictedAction" IS NOT NULL)
    ),
    -- NO permanent block: every block expires, after the decision, automated within 24 h, administrator within 30 days
    CONSTRAINT "lead_abuse_decisions_block_expiry_check" CHECK (
        "action" <> 'TEMPORARY_BLOCK' OR (
            "expiresAt" IS NOT NULL AND "expiresAt" > "decidedAt"
            AND "expiresAt" <= "decidedAt" + CASE WHEN "origin" = 'AUTOMATED' THEN INTERVAL '24 hours' ELSE INTERVAL '30 days' END
        )
    ),
    CONSTRAINT "lead_abuse_decisions_flag_no_expiry_check" CHECK ("action" <> 'FLAG_FOR_REVIEW' OR "expiresAt" IS NULL),
    -- automated: a rule, no human; administrator: a human and an explanation
    CONSTRAINT "lead_abuse_decisions_origin_check" CHECK (
        (
            "origin" = 'AUTOMATED' AND "createdByUserId" IS NULL AND "ruleKey" IS NOT NULL AND "ruleVersion" IS NOT NULL AND "explanation" IS NULL
        ) OR (
            "origin" = 'ADMIN' AND "createdByUserId" IS NOT NULL AND "explanation" IS NOT NULL AND "action" = 'TEMPORARY_BLOCK'
        )
    ),
    CONSTRAINT "lead_abuse_decisions_status_check" CHECK (
        ("status" = 'ACTIVE' AND "liftedAt" IS NULL AND "liftedByUserId" IS NULL AND "resolutionNote" IS NULL)
        OR ("status" = 'LIFTED' AND "liftedAt" IS NOT NULL AND "liftedByUserId" IS NOT NULL AND "resolutionNote" IS NOT NULL)
        OR ("status" = 'EXPIRED' AND "action" = 'TEMPORARY_BLOCK' AND "liftedAt" IS NULL AND "liftedByUserId" IS NULL AND "resolutionNote" IS NULL)
    ),
    CONSTRAINT "lead_abuse_decisions_text_check" CHECK (
        ("explanation" IS NULL OR length(btrim("explanation")) > 0) AND ("resolutionNote" IS NULL OR length(btrim("resolutionNote")) > 0)
    )
);

-- CreateIndex
CREATE UNIQUE INDEX "lead_abuse_signals_dedupeKey_key" ON "lead_abuse_signals"("dedupeKey");
CREATE INDEX "lead_abuse_signals_subjectUserId_signalType_occurredAt_idx" ON "lead_abuse_signals"("subjectUserId", "signalType", "occurredAt");
CREATE INDEX "lead_abuse_decisions_subjectUserId_status_idx" ON "lead_abuse_decisions"("subjectUserId", "status");
CREATE INDEX "lead_abuse_decisions_action_status_decidedAt_idx" ON "lead_abuse_decisions"("action", "status", "decidedAt");

-- At most ONE active flag and ONE active block (per restricted action) for a subject: the arbiter of concurrent writers.
CREATE UNIQUE INDEX "lead_abuse_decisions_one_active_flag"
    ON "lead_abuse_decisions" ("subjectUserId") WHERE "status" = 'ACTIVE' AND "action" = 'FLAG_FOR_REVIEW';
CREATE UNIQUE INDEX "lead_abuse_decisions_one_active_block"
    ON "lead_abuse_decisions" ("subjectUserId", "restrictedAction") WHERE "status" = 'ACTIVE' AND "action" = 'TEMPORARY_BLOCK';

-- AddForeignKey (the actor columns are plain uuids, like the M155 actor columns: an actor's later erasure must not block history)
ALTER TABLE "lead_abuse_signals" ADD CONSTRAINT "lead_abuse_signals_subjectUserId_fkey" FOREIGN KEY ("subjectUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "lead_abuse_decisions" ADD CONSTRAINT "lead_abuse_decisions_subjectUserId_fkey" FOREIGN KEY ("subjectUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Signals are append-only evidence.
CREATE OR REPLACE FUNCTION lead_abuse_signals_append_only() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'lead_abuse_signals rows are append-only (signal %)', OLD."id"
        USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER lead_abuse_signals_append_only_trg
    BEFORE UPDATE OR DELETE ON "lead_abuse_signals"
    FOR EACH ROW EXECUTE FUNCTION lead_abuse_signals_append_only();

-- Decisions are never deleted.
CREATE OR REPLACE FUNCTION lead_abuse_no_delete() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'lead_abuse_decisions rows are never deleted (decision %)', OLD."id"
        USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER lead_abuse_decisions_no_delete_trg
    BEFORE DELETE ON "lead_abuse_decisions"
    FOR EACH ROW EXECUTE FUNCTION lead_abuse_no_delete();

-- Decision identity and content are immutable; status moves ACTIVE -> LIFTED | EXPIRED only (terminal states are absorbing).
CREATE OR REPLACE FUNCTION lead_abuse_decisions_guard_update() RETURNS trigger AS $$
BEGIN
    IF NEW."id" IS DISTINCT FROM OLD."id"
       OR NEW."subjectUserId" IS DISTINCT FROM OLD."subjectUserId"
       OR NEW."action" IS DISTINCT FROM OLD."action"
       OR NEW."restrictedAction" IS DISTINCT FROM OLD."restrictedAction"
       OR NEW."origin" IS DISTINCT FROM OLD."origin"
       OR NEW."ruleKey" IS DISTINCT FROM OLD."ruleKey"
       OR NEW."ruleVersion" IS DISTINCT FROM OLD."ruleVersion"
       OR NEW."reasonCode" IS DISTINCT FROM OLD."reasonCode"
       OR NEW."createdByUserId" IS DISTINCT FROM OLD."createdByUserId"
       OR NEW."decidedAt" IS DISTINCT FROM OLD."decidedAt"
       OR NEW."expiresAt" IS DISTINCT FROM OLD."expiresAt"
       OR NEW."explanation" IS DISTINCT FROM OLD."explanation"
       OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
        RAISE EXCEPTION 'lead_abuse_decisions identity / decision columns are immutable (decision %)', OLD."id"
            USING ERRCODE = 'check_violation';
    END IF;

    IF NEW."status" <> OLD."status" AND NOT (OLD."status" = 'ACTIVE' AND NEW."status" IN ('LIFTED', 'EXPIRED')) THEN
        RAISE EXCEPTION 'lead_abuse_decisions status % -> % is not allowed (decision %)', OLD."status", NEW."status", OLD."id"
            USING ERRCODE = 'check_violation';
    END IF;

    IF OLD."status" <> 'ACTIVE' AND (
           NEW."liftedAt" IS DISTINCT FROM OLD."liftedAt"
        OR NEW."liftedByUserId" IS DISTINCT FROM OLD."liftedByUserId"
        OR NEW."resolutionNote" IS DISTINCT FROM OLD."resolutionNote") THEN
        RAISE EXCEPTION 'lead_abuse_decisions resolution columns are write-once (decision %)', OLD."id"
            USING ERRCODE = 'check_violation';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER lead_abuse_decisions_guard_update_trg
    BEFORE UPDATE ON "lead_abuse_decisions"
    FOR EACH ROW EXECUTE FUNCTION lead_abuse_decisions_guard_update();
