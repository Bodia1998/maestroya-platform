-- Hand-authored (same caveat as every prior migration in this repo: no
-- Postgres/engine access in this sandbox to run `prisma migrate dev` and
-- have it generate this file from a real diff — see
-- docs/MODULE_21_DISPUTES_SUPPORT.md, "Validation Results", for the same
-- confirmed precedent). Mirrors what that command would produce for the
-- schema change below. Run the real command once you have a database
-- locally to double-check, then delete this comment block.
--
-- Module 38 — GDPR Compliance.
--
-- Purely additive: one brand-new enum (ConsentType) plus one brand-new
-- table ("consents"). Nothing existing is renamed, dropped, or altered.

-- ============================================================================
-- ConsentType + "consents"
-- ============================================================================
CREATE TYPE "ConsentType" AS ENUM (
    'TERMS_OF_SERVICE',
    'PRIVACY_POLICY',
    'MARKETING'
);

CREATE TABLE "consents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "userId" UUID NOT NULL,
    "type" "ConsentType" NOT NULL,
    "version" TEXT NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "withdrawnAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "consents_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "consents_userId_idx" ON "consents"("userId");
CREATE INDEX "consents_userId_type_idx" ON "consents"("userId", "type");

ALTER TABLE "consents" ADD CONSTRAINT "consents_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Module 33 — Security Hardening checklist (see
-- prisma/migrations/20260811000000_enable_row_level_security/migration.sql):
-- every new table must enable RLS with zero policies (default-deny for
-- every role except the Prisma connection's table-owning role).
ALTER TABLE "public"."consents" ENABLE ROW LEVEL SECURITY;
