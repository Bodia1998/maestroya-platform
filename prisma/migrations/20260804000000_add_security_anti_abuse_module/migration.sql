-- Hand-authored (same caveat as every prior migration in this repo: no
-- Postgres/engine access in this sandbox to run `prisma migrate dev` and
-- have it generate this file from a real diff — see
-- docs/MODULE_19_SEARCH_RANKING.md / docs/MODULE_20_MAPS_GEOLOCATION.md /
-- docs/MODULE_21_DISPUTES_SUPPORT.md, "Validation Results", for the same
-- confirmed precedent). Mirrors what that command would produce for the
-- schema changes below. Run the real command once you have a database
-- locally to double-check, then delete this comment block.
--
-- Module 24 — Security & Anti-Abuse.
--
-- Purely additive: two brand-new tables (security_events,
-- account_restrictions), two brand-new enums for each, plus back-relations
-- on "users". Nothing existing is renamed, dropped, or altered. No existing
-- data is touched.

-- ============================================================================
-- SecurityEventType + security_events
-- ============================================================================
CREATE TYPE "SecurityEventType" AS ENUM (
    'LOGIN_FAILED',
    'LOGIN_SUCCEEDED',
    'ACCOUNT_CREATED',
    'PASSWORD_RESET_REQUESTED',
    'PASSWORD_RESET_COMPLETED',
    'EMAIL_VERIFICATION_REQUESTED',
    'RATE_LIMIT_TRIGGERED',
    'ACCOUNT_TEMPORARILY_BLOCKED',
    'SUSPICIOUS_ACTIVITY_DETECTED',
    'SERVICE_REQUEST_RATE_LIMITED',
    'QUOTE_RATE_LIMITED',
    'MESSAGE_RATE_LIMITED',
    'REVIEW_RATE_LIMITED',
    'ADMIN_ACTION',
    'SECURITY_POLICY_BLOCKED'
);

CREATE TABLE "security_events" (
    "id" UUID NOT NULL,
    "type" "SecurityEventType" NOT NULL,
    "userId" UUID,
    "ipHash" TEXT,
    "userAgent" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "security_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "security_events_type_idx" ON "security_events"("type");
CREATE INDEX "security_events_userId_idx" ON "security_events"("userId");
CREATE INDEX "security_events_createdAt_idx" ON "security_events"("createdAt");

ALTER TABLE "security_events" ADD CONSTRAINT "security_events_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================================================================
-- AccountRestrictionState / AccountRestrictionReason + account_restrictions
-- ============================================================================
CREATE TYPE "AccountRestrictionState" AS ENUM (
    'THROTTLED',
    'TEMPORARILY_BLOCKED',
    'FLAGGED'
);

CREATE TYPE "AccountRestrictionReason" AS ENUM (
    'FAILED_LOGIN_BURST',
    'REGISTRATION_ABUSE',
    'SERVICE_REQUEST_SPAM',
    'QUOTE_SPAM',
    'MESSAGE_SPAM',
    'REVIEW_ABUSE',
    'ADMIN_DECISION',
    'OTHER'
);

CREATE TABLE "account_restrictions" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "state" "AccountRestrictionState" NOT NULL,
    "reason" "AccountRestrictionReason" NOT NULL,
    "notes" TEXT,
    "createdByUserId" UUID,
    "expiresAt" TIMESTAMP(3),
    "liftedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "account_restrictions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "account_restrictions_userId_state_idx" ON "account_restrictions"("userId", "state");
CREATE INDEX "account_restrictions_expiresAt_idx" ON "account_restrictions"("expiresAt");

ALTER TABLE "account_restrictions" ADD CONSTRAINT "account_restrictions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "account_restrictions" ADD CONSTRAINT "account_restrictions_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
