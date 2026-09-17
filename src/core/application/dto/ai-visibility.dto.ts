import { z } from "zod";

import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from "@/domain/services/admin-rules";
import { isKnownAiVisibilityQueryId } from "@/shared/content/ai-visibility-queries";
import { MAX_EVIDENCE_EXCERPT_LENGTH } from "@/domain/services/ai-visibility-evaluation";

/**
 * Module 119 — AI Recommendation Monitoring: Zod boundary for the manual
 * observation-capture Server Action, same convention as `admin.dto.ts`.
 * Deliberately absent: `recordedByUserId` — always resolved server-side
 * from the session, never accepted as client input (same rule
 * `admin.dto.ts`'s own doc comment states for every admin action).
 */

const accuracySchema = z.enum(["CORRECT", "INCORRECT", "NOT_APPLICABLE"]);
const urlAccuracySchema = z.enum(["CORRECT", "INCORRECT", "NOT_PROVIDED"]);

export const recordAiVisibilityObservationSchema = z.object({
  queryId: z.string().min(1, "A query is required.").refine(isKnownAiVisibilityQueryId, {
    message: "Unknown query id — must be one of the active AI visibility queries.",
  }),
  provider: z.enum(["MANUAL", "OPENAI_API", "ANTHROPIC_API", "GOOGLE_API", "PERPLEXITY_API", "OTHER"]),
  providerModel: z.string().trim().max(200).optional().nullable(),
  observedAt: z.coerce.date(),
  mentioned: z.boolean(),
  identityAccuracy: accuracySchema,
  geographicAccuracy: accuracySchema,
  serviceAccuracy: accuracySchema,
  urlAccuracy: urlAccuracySchema,
  citationPresent: z.boolean(),
  citationCorrect: z.boolean().nullable(),
  recommendationClassification: z.enum(["NOT_MENTIONED", "MENTIONED_ONLY", "LISTED_AMONG_OPTIONS", "RECOMMENDED"]),
  detectedCompetitors: z.array(z.string().trim().min(1)).max(20).default([]),
  factualIssues: z.array(z.string().trim().min(1)).max(20).default([]),
  evaluatorNotes: z.string().trim().max(2000).optional().nullable(),
  evidenceType: z.enum(["MANUAL_TRANSCRIPT_EXCERPT", "MANUAL_SCREENSHOT_REFERENCE", "API_RESPONSE_REFERENCE", "EXTERNAL_ARTICLE_REFERENCE"]),
  evidenceReference: z.string().trim().max(2000).optional().nullable(),
  evidenceExcerpt: z.string().trim().max(MAX_EVIDENCE_EXCERPT_LENGTH).optional().nullable(),
});
export type RecordAiVisibilityObservationInput = z.infer<typeof recordAiVisibilityObservationSchema>;

export const listAiVisibilityObservationsSchema = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  offset: z.coerce.number().int().min(0).default(0),
});
export type ListAiVisibilityObservationsInput = z.infer<typeof listAiVisibilityObservationsSchema>;
