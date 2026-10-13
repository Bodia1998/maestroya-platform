import type { JobValueEstimationContextReader } from "@/application/ports/job-value-estimation-context-reader";
import type { LeadPricingContextReader } from "@/application/ports/lead-pricing-context-reader";
import type { LeadScopeAnswersReader } from "@/application/ports/lead-scope-answers-reader";
import type { LeadPricingContext } from "@/domain/services/lead-pricing";
import { estimateJobValue, type JobValueEstimationConfig } from "@/domain/services/job-value-estimation";
import {
  deriveStructuredScope,
  type LeadScopeProvenance,
  type ScopeQuestionnaireRegistry,
} from "@/domain/services/lead-scope-questionnaire";

/**
 * Module 129 — LeadPricingContextReader whose `estimatedServiceValue` comes
 * from the Job Value Estimation capability.
 *
 * Responsibility split: this class only ADAPTS the estimate into the Lead
 * pricing context. It contains no estimation formula and no pricing logic.
 * Anything other than an ESTIMATED result becomes `estimatedServiceValue:
 * null`, which Module 128 turns into UNPRICED (fail closed) — an unavailable
 * estimate can never become a zero or cheap price. Confidence is passed
 * through unchanged; Module 128 enforces its own minimum.
 *
 * Module 163: when a scope reader + questionnaire registry are supplied and the
 * request has STORED structured scope, the stored answers are re-validated
 * against the current definition (version must match exactly) and the derived
 * factors are handed to the estimator. Stored scope that cannot be used —
 * invalid, a different questionnaire version, a category without a questionnaire,
 * a non-LEAD_V1 flow — makes the estimate unavailable (UNPRICED): it is NEVER
 * silently treated as "no scope", because that would price the lead on less
 * information than the customer gave. A request with no stored scope is
 * estimated exactly as before.
 */
export interface EstimatedLeadPricingContext extends LeadPricingContext {
  /** The validated scope the estimate used; absent when it used none. For the publication snapshot's provenance. */
  scope?: LeadScopeProvenance;
}

export interface LeadScopeEstimationSource {
  reader: LeadScopeAnswersReader;
  registry: ScopeQuestionnaireRegistry;
}

export class EstimatedValueLeadPricingContextReader implements LeadPricingContextReader {
  constructor(
    private readonly contexts: JobValueEstimationContextReader,
    private readonly config: JobValueEstimationConfig,
    private readonly scopeSource?: LeadScopeEstimationSource,
  ) {}

  async findByLeadId(leadId: string): Promise<EstimatedLeadPricingContext | null> {
    const context = await this.contexts.findByLeadId(leadId);
    if (!context) return null;

    let estimationContext = context;
    let scope: LeadScopeProvenance | null = null;
    let scopeUnusable = false;

    const stored = this.scopeSource ? await this.scopeSource.reader.findByLeadId(leadId) : null;
    if (this.scopeSource && stored) {
      const derivation = deriveStructuredScope(this.scopeSource.registry, context, stored.answers);
      if (derivation.status === "STRUCTURED" && derivation.structuredScope.questionnaireVersion === stored.questionnaireVersion) {
        estimationContext = { ...context, structuredScope: derivation.structuredScope };
        scope = { questionnaireVersion: stored.questionnaireVersion, answers: derivation.answers };
      } else {
        scopeUnusable = true;
      }
    }

    const estimate = scopeUnusable ? null : estimateJobValue(estimationContext, this.config);
    return {
      flowVersion: context.flowVersion,
      categorySlug: context.categorySlug,
      parentCategorySlug: context.parentCategorySlug,
      urgency: context.urgency,
      estimatedServiceValue:
        estimate?.status === "ESTIMATED"
          ? { amount: estimate.estimatedServiceValue, currency: estimate.currency, confidence: estimate.confidence }
          : null,
      // Key present only when the estimate really used structured scope, so contexts without it keep their pre-M163 shape.
      ...(estimate?.status === "ESTIMATED" && scope ? { scope } : {}),
    };
  }
}
