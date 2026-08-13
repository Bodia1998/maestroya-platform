-- Hand-authored (same caveat as every prior migration in this repo: no
-- Postgres/Prisma-engine access in this sandbox to run `prisma migrate dev`
-- and have it generate this file from a real diff — see
-- docs/MODULE_21_DISPUTES_SUPPORT.md, "Validation Results", and
-- prisma/migrations/20260816000000_add_professional_verification_provider/
-- migration.sql for the same confirmed precedent). Mirrors what that
-- command would produce for the schema changes below. Run the real command
-- once you have a database locally to double-check, then delete this
-- comment block.
--
-- Module 60 — Referral & Marketing Attribution Platform.
--
-- Purely additive: two new enums, four new tables, two new columns on the
-- existing `users` table's back-relations (no schema change on `users`
-- itself — those are Prisma-side relation fields only, not FK columns).
-- No existing table is altered, renamed, or dropped.

-- 1. Marketing source / conversion type enums.
CREATE TYPE "MarketingSourceKind" AS ENUM (
  'TELEGRAM', 'INSTAGRAM', 'TIKTOK', 'FACEBOOK', 'GOOGLE_ADS', 'YOUTUBE',
  'ORGANIC_SEARCH', 'DIRECT', 'REFERRAL', 'EMAIL', 'UNKNOWN'
);

CREATE TYPE "ConversionTypeKind" AS ENUM (
  'REGISTRATION', 'PROFESSIONAL_REGISTRATION', 'CLIENT_REGISTRATION',
  'BOOKING_CREATED', 'BOOKING_COMPLETED', 'COMMISSION_GENERATED'
);

-- 2. Administered referral codes.
CREATE TABLE "referral_codes" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "code" VARCHAR(40) NOT NULL,
  "ownerUserId" UUID,
  "label" VARCHAR(120),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "referral_codes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "referral_codes_code_key" ON "referral_codes" ("code");
CREATE INDEX "referral_codes_ownerUserId_idx" ON "referral_codes" ("ownerUserId");

ALTER TABLE "referral_codes"
  ADD CONSTRAINT "referral_codes_ownerUserId_fkey"
  FOREIGN KEY ("ownerUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 3. Tracked visits (dedup is applied in application code, not the schema —
--    see domain/services/referral-visit-dedup-rules.ts).
CREATE TABLE "referral_visits" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "visitorId" VARCHAR(100) NOT NULL,
  "referralCode" VARCHAR(40),
  "utmSource" VARCHAR(191),
  "utmMedium" VARCHAR(191),
  "utmCampaign" VARCHAR(191),
  "utmContent" VARCHAR(191),
  "utmTerm" VARCHAR(191),
  "marketingSource" "MarketingSourceKind" NOT NULL,
  "ipHash" VARCHAR(64),
  "userAgentTruncated" VARCHAR(200),
  "landingPage" VARCHAR(500) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "referral_visits_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "referral_visits_visitorId_createdAt_idx" ON "referral_visits" ("visitorId", "createdAt");
CREATE INDEX "referral_visits_referralCode_idx" ON "referral_visits" ("referralCode");
CREATE INDEX "referral_visits_utmCampaign_idx" ON "referral_visits" ("utmCampaign");

-- 4. One row per visitor — write-once first-touch, always-overwritten
--    last-touch (enforced at the application level, see
--    marketing-attribution-touch-rules.ts).
CREATE TABLE "marketing_attributions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "visitorId" VARCHAR(100) NOT NULL,
  "firstSource" "MarketingSourceKind" NOT NULL,
  "firstCampaign" VARCHAR(191),
  "firstReferralCode" VARCHAR(40),
  "firstVisitAt" TIMESTAMP(3) NOT NULL,
  "lastSource" "MarketingSourceKind" NOT NULL,
  "lastCampaign" VARCHAR(191),
  "lastReferralCode" VARCHAR(40),
  "lastVisitAt" TIMESTAMP(3) NOT NULL,
  "userId" UUID,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "marketing_attributions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "marketing_attributions_visitorId_key" ON "marketing_attributions" ("visitorId");
CREATE INDEX "marketing_attributions_userId_idx" ON "marketing_attributions" ("userId");

ALTER TABLE "marketing_attributions"
  ADD CONSTRAINT "marketing_attributions_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 5. Read-only conversion markers — never written to by this migration's
--    tables above beyond the shape below; `referenceId` deliberately has
--    no cross-module FK constraint (see conversion-event-repository.ts).
CREATE TABLE "conversion_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "attributionId" UUID NOT NULL,
  "type" "ConversionTypeKind" NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "referenceId" VARCHAR(191),
  "revenueAmount" DECIMAL(10, 2),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "conversion_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "conversion_events_attributionId_idx" ON "conversion_events" ("attributionId");
CREATE INDEX "conversion_events_type_idx" ON "conversion_events" ("type");

ALTER TABLE "conversion_events"
  ADD CONSTRAINT "conversion_events_attributionId_fkey"
  FOREIGN KEY ("attributionId") REFERENCES "marketing_attributions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
