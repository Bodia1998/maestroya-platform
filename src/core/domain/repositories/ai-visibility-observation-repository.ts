/**
 * Module 119 — AI Recommendation Monitoring: repository interface for the
 * append-only observation trail. Same "no update/delete method" discipline
 * as AdminAuditLogRepository (see that file's own doc comment) — an AI
 * visibility observation is a timestamped record of what a specific
 * response looked like at a specific moment; correcting it means recording
 * a NEW observation, never rewriting history (Module 119's own
 * non-negotiable rule: "Preserve historical observations rather than
 * overwriting them").
 *
 * This interface intentionally says nothing about *how* an observation is
 * produced (manual capture vs. a future official-API integration) — see
 * `AiVisibilityProviderKind` below and the Module 119 report's "Provider
 * Abstraction" section. `record()` only ever persists an already-evaluated
 * observation; it never itself contacts an AI system.
 */

/** Mirrors the Prisma `AiVisibilityProvider` enum. Kept as a plain string
 *  union here (not imported from `@prisma/client`) so this domain-layer
 *  file has no dependency on the ORM, matching every other repository
 *  interface in `core/domain/repositories`. */
export type AiVisibilityProviderKind = "MANUAL" | "OPENAI_API" | "ANTHROPIC_API" | "GOOGLE_API" | "PERPLEXITY_API" | "OTHER";

export type AiVisibilityAccuracyValue = "CORRECT" | "INCORRECT" | "NOT_APPLICABLE";

export type AiVisibilityUrlAccuracyValue = "CORRECT" | "INCORRECT" | "NOT_PROVIDED";

export type AiVisibilityRecommendationClassificationValue =
  | "NOT_MENTIONED"
  | "MENTIONED_ONLY"
  | "LISTED_AMONG_OPTIONS"
  | "RECOMMENDED";

export type AiVisibilityEvidenceTypeValue =
  | "MANUAL_TRANSCRIPT_EXCERPT"
  | "MANUAL_SCREENSHOT_REFERENCE"
  | "API_RESPONSE_REFERENCE"
  | "EXTERNAL_ARTICLE_REFERENCE";

export interface RecordAiVisibilityObservationData {
  queryId: string;
  provider: AiVisibilityProviderKind;
  providerModel: string | null;
  observedAt: Date;
  /** Resolved server-side from the authenticated session — never accepted
   *  as client input (same "actor is always session-derived" rule as
   *  `RecordAdminAuditLogData.adminUserId`). */
  recordedByUserId: string | null;
  evaluationRulesVersion: string;
  mentioned: boolean;
  identityAccuracy: AiVisibilityAccuracyValue;
  geographicAccuracy: AiVisibilityAccuracyValue;
  serviceAccuracy: AiVisibilityAccuracyValue;
  urlAccuracy: AiVisibilityUrlAccuracyValue;
  citationPresent: boolean;
  citationCorrect: boolean | null;
  recommendationClassification: AiVisibilityRecommendationClassificationValue;
  detectedCompetitors: string[];
  factualIssues: string[];
  evaluatorNotes: string | null;
  evidenceType: AiVisibilityEvidenceTypeValue;
  evidenceReference: string | null;
  evidenceExcerpt: string | null;
}

export interface AiVisibilityObservationRecord extends RecordAiVisibilityObservationData {
  id: string;
  createdAt: Date;
}

export interface ListAiVisibilityObservationsOptions {
  limit: number;
  offset: number;
  /** Filter to a single query, provider, or a time window — every field
   *  optional; omitting all of them lists every observation, newest
   *  first. */
  queryId?: string;
  provider?: AiVisibilityProviderKind;
  observedFrom?: Date;
  observedTo?: Date;
}

export interface AiVisibilityObservationRepository {
  /** Always inserts a new row — see this file's own doc comment. */
  record(data: RecordAiVisibilityObservationData): Promise<AiVisibilityObservationRecord>;
  /** Newest-observed-first, read-only, paginated, optionally filtered. */
  list(options: ListAiVisibilityObservationsOptions): Promise<AiVisibilityObservationRecord[]>;
  /** All observations within an (optional) time window — used by
   *  GetAiVisibilityMetricsUseCase to compute rates over a period. Not
   *  paginated: metrics need the full period's rows to compute an
   *  accurate denominator, and this module's data volume (a small,
   *  curated query dataset, observed periodically, never mass-queried —
   *  see this module's own non-negotiable rules) is never large enough to
   *  make that unsafe. */
  listForPeriod(period: { from: Date | null; to: Date | null }): Promise<AiVisibilityObservationRecord[]>;
}
