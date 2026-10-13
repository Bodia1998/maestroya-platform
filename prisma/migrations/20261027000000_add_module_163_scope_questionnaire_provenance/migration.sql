-- Hand-authored (same caveat as prior migrations in this repo).
--
-- Module 163 — Structured scope questionnaire: persisted answers and
-- questionnaire-version provenance.
--
-- Additive: two NULLABLE columns on "service_requests" and two NULLABLE columns
-- on "leads", plus CHECK constraints. No column is dropped/renamed/rewritten and
-- no row is updated: every existing row keeps all four columns NULL (= "no
-- structured scope"). LeadPurchase and every legacy financial table are
-- untouched.
--
-- M133 compatibility. The ten M133 publication columns stay an all-or-nothing
-- group guarded by "leads_publication_snapshot_all_or_nothing"
-- (num_nonnulls(...) IN (0, 10)). That constraint is NOT modified and the new
-- columns are NOT part of it: a lead published without structured scope must
-- still satisfy it with the new columns NULL. The new columns get their own
-- checks. The only existing object touched is the immutability trigger
-- FUNCTION, replaced (same name, same trigger) so that the scope provenance is
-- immutable once published exactly like the rest of the snapshot.
--
-- Rollback: DROP the five constraints below, DROP COLUMN the four columns, and
-- re-run the M133 definition of leads_publication_snapshot_immutable().

-- AlterTable
ALTER TABLE "service_requests"
    ADD COLUMN "scopeAnswers" JSONB,
    ADD COLUMN "scopeQuestionnaireVersion" TEXT;

-- Answers and version are written together or not at all.
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_scope_all_or_nothing" CHECK (
    ("scopeAnswers" IS NULL) = ("scopeQuestionnaireVersion" IS NULL)
);

-- Answers are a non-empty JSON object; the version has the application's version shape.
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_scope_shape" CHECK (
    "scopeAnswers" IS NULL OR (
        jsonb_typeof("scopeAnswers") = 'object'
        AND "scopeAnswers" <> '{}'::jsonb
        AND "scopeQuestionnaireVersion" ~ '^[a-z0-9][a-z0-9._-]{0,63}$'
    )
);

-- Legacy isolation: structured scope exists only on LEAD_V1 requests.
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_scope_lead_v1_only" CHECK (
    "scopeAnswers" IS NULL OR "flowVersion" = 'LEAD_V1'
);

-- AlterTable
ALTER TABLE "leads"
    ADD COLUMN "publicationScopeQuestionnaireVersion" TEXT,
    ADD COLUMN "publicationScopeAnswers" JSONB;

-- Version and answers together or not at all, well-shaped, and only on a published lead.
ALTER TABLE "leads" ADD CONSTRAINT "leads_publication_scope_all_or_nothing" CHECK (
    ("publicationScopeQuestionnaireVersion" IS NULL) = ("publicationScopeAnswers" IS NULL)
);

ALTER TABLE "leads" ADD CONSTRAINT "leads_publication_scope_valid" CHECK (
    "publicationScopeAnswers" IS NULL OR (
        "publishedAt" IS NOT NULL
        AND jsonb_typeof("publicationScopeAnswers") = 'object'
        AND "publicationScopeAnswers" <> '{}'::jsonb
        AND "publicationScopeQuestionnaireVersion" ~ '^[a-z0-9][a-z0-9._-]{0,63}$'
    )
);

-- Once a snapshot exists it can never be changed or removed — now including the scope provenance.
CREATE OR REPLACE FUNCTION leads_publication_snapshot_immutable() RETURNS trigger AS $$
BEGIN
    IF OLD."publishedAt" IS NOT NULL AND (
        NEW."publishedAt" IS DISTINCT FROM OLD."publishedAt"
        OR NEW."publicationPrice" IS DISTINCT FROM OLD."publicationPrice"
        OR NEW."publicationCurrency" IS DISTINCT FROM OLD."publicationCurrency"
        OR NEW."publicationEstimatedJobValue" IS DISTINCT FROM OLD."publicationEstimatedJobValue"
        OR NEW."publicationPricingRate" IS DISTINCT FROM OLD."publicationPricingRate"
        OR NEW."publicationPricingConfidence" IS DISTINCT FROM OLD."publicationPricingConfidence"
        OR NEW."publicationPricingConfigVersion" IS DISTINCT FROM OLD."publicationPricingConfigVersion"
        OR NEW."publicationJobValueRuleVersion" IS DISTINCT FROM OLD."publicationJobValueRuleVersion"
        OR NEW."publicationPricingRuleVersion" IS DISTINCT FROM OLD."publicationPricingRuleVersion"
        OR NEW."publicationBuyerPolicyVersion" IS DISTINCT FROM OLD."publicationBuyerPolicyVersion"
        OR NEW."publicationScopeQuestionnaireVersion" IS DISTINCT FROM OLD."publicationScopeQuestionnaireVersion"
        OR NEW."publicationScopeAnswers" IS DISTINCT FROM OLD."publicationScopeAnswers"
        OR NEW."maxBuyers" IS DISTINCT FROM OLD."maxBuyers"
    ) THEN
        RAISE EXCEPTION 'Lead publication snapshot is immutable (lead %)', OLD."id"
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
