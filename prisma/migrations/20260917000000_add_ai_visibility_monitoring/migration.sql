-- Hand-authored (same caveat as every prior migration in this repo: no
-- Postgres/Prisma-engine access in this sandbox to run `prisma migrate dev`
-- and have it generate this file from a real diff — see the Module 117/118
-- reports' own "sandbox Prisma engine mismatch" limitation).
--
-- Module 119 — AI Recommendation Monitoring.
--
-- Purely additive: four new enums and one new, append-only table
-- (`ai_visibility_observations`). No existing table, column, enum, or
-- constraint is altered, renamed, or dropped. No existing row's behavior
-- changes. `recordedByUserId` is a nullable FK to `users` with
-- `ON DELETE SET NULL` (same convention as `audit_logs.actorUserId`) so
-- deleting a user account never blocks or cascades into deleting a
-- historical observation.

-- CreateEnum
CREATE TYPE "AiVisibilityProvider" AS ENUM ('MANUAL', 'OPENAI_API', 'ANTHROPIC_API', 'GOOGLE_API', 'PERPLEXITY_API', 'OTHER');

-- CreateEnum
CREATE TYPE "AiVisibilityAccuracy" AS ENUM ('CORRECT', 'INCORRECT', 'NOT_APPLICABLE');

-- CreateEnum
CREATE TYPE "AiVisibilityUrlAccuracy" AS ENUM ('CORRECT', 'INCORRECT', 'NOT_PROVIDED');

-- CreateEnum
CREATE TYPE "AiVisibilityRecommendationClassification" AS ENUM ('NOT_MENTIONED', 'MENTIONED_ONLY', 'LISTED_AMONG_OPTIONS', 'RECOMMENDED');

-- CreateEnum
CREATE TYPE "AiVisibilityEvidenceType" AS ENUM ('MANUAL_TRANSCRIPT_EXCERPT', 'MANUAL_SCREENSHOT_REFERENCE', 'API_RESPONSE_REFERENCE', 'EXTERNAL_ARTICLE_REFERENCE');

-- CreateTable
CREATE TABLE "ai_visibility_observations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "queryId" TEXT NOT NULL,
    "provider" "AiVisibilityProvider" NOT NULL,
    "providerModel" TEXT,
    "observedAt" TIMESTAMP(3) NOT NULL,
    "recordedByUserId" UUID,
    "evaluationRulesVersion" TEXT NOT NULL,
    "mentioned" BOOLEAN NOT NULL,
    "identityAccuracy" "AiVisibilityAccuracy" NOT NULL,
    "geographicAccuracy" "AiVisibilityAccuracy" NOT NULL,
    "serviceAccuracy" "AiVisibilityAccuracy" NOT NULL,
    "urlAccuracy" "AiVisibilityUrlAccuracy" NOT NULL,
    "citationPresent" BOOLEAN NOT NULL,
    "citationCorrect" BOOLEAN,
    "recommendationClassification" "AiVisibilityRecommendationClassification" NOT NULL,
    "detectedCompetitors" JSONB,
    "factualIssues" JSONB,
    "evaluatorNotes" TEXT,
    "evidenceType" "AiVisibilityEvidenceType" NOT NULL,
    "evidenceReference" TEXT,
    "evidenceExcerpt" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_visibility_observations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_visibility_observations_queryId_idx" ON "ai_visibility_observations"("queryId");

-- CreateIndex
CREATE INDEX "ai_visibility_observations_provider_idx" ON "ai_visibility_observations"("provider");

-- CreateIndex
CREATE INDEX "ai_visibility_observations_observedAt_idx" ON "ai_visibility_observations"("observedAt");

-- CreateIndex
CREATE INDEX "ai_visibility_observations_createdAt_idx" ON "ai_visibility_observations"("createdAt");

-- AddForeignKey
ALTER TABLE "ai_visibility_observations" ADD CONSTRAINT "ai_visibility_observations_recordedByUserId_fkey" FOREIGN KEY ("recordedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
