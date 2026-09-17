import { ValidationError } from "@/domain/errors/domain-error";
import type {
  AiVisibilityObservationRecord,
  AiVisibilityObservationRepository,
  RecordAiVisibilityObservationData,
} from "@/domain/repositories/ai-visibility-observation-repository";
import { isKnownAiVisibilityQueryId } from "@/shared/content/ai-visibility-queries";
import { assertEvidenceExcerptWithinLimit, EVALUATION_RULES_VERSION } from "@/domain/services/ai-visibility-evaluation";

export interface RecordAiVisibilityObservationInput extends Omit<RecordAiVisibilityObservationData, "evaluationRulesVersion" | "recordedByUserId"> {
  /** Optional override — defaults to the current
   *  `EVALUATION_RULES_VERSION` so a caller never has to supply it by
   *  hand for a normal capture. Only ever overridden by a test replaying
   *  a historical ruleset. */
  evaluationRulesVersion?: string;
}

/**
 * Module 119 — AI Recommendation Monitoring: records one, immutable,
 * timestamped observation. This use case is the ONLY place a `queryId`
 * is validated against the code-defined query catalog (Phase 4) — the
 * repository/database layer accepts any string (see this model's own
 * "not a foreign key" doc comment), so this is the actual enforcement
 * point preventing an observation from being recorded against a query
 * that doesn't exist in the controlled dataset.
 *
 * Deliberately does not itself contact any AI system, provider API, or
 * external service — it only persists an already-captured, already-
 * evaluated observation. See the Module 119 report's "Provider
 * Abstraction" section.
 */
export class RecordAiVisibilityObservationUseCase {
  constructor(private readonly observations: AiVisibilityObservationRepository) {}

  async execute(recordedByUserId: string | null, input: RecordAiVisibilityObservationInput): Promise<AiVisibilityObservationRecord> {
    if (!isKnownAiVisibilityQueryId(input.queryId)) {
      throw new ValidationError(`Unknown AI visibility query id: "${input.queryId}". Add it to the query catalog first.`);
    }

    if (input.evidenceExcerpt) {
      assertEvidenceExcerptWithinLimit(input.evidenceExcerpt);
    }

    // Non-negotiable internal-consistency guards — these are objective
    // facts about the observation's own shape, not evaluator judgment
    // calls, so this use case enforces them rather than trusting every
    // caller to get them right.
    if (!input.mentioned && input.recommendationClassification !== "NOT_MENTIONED") {
      throw new ValidationError('recommendationClassification must be "NOT_MENTIONED" when mentioned is false.');
    }
    if (input.mentioned && input.recommendationClassification === "NOT_MENTIONED") {
      throw new ValidationError('recommendationClassification cannot be "NOT_MENTIONED" when mentioned is true.');
    }
    if (!input.citationPresent && input.citationCorrect !== null) {
      throw new ValidationError("citationCorrect must be null when citationPresent is false.");
    }

    return this.observations.record({
      ...input,
      recordedByUserId,
      evaluationRulesVersion: input.evaluationRulesVersion ?? EVALUATION_RULES_VERSION,
    });
  }
}
