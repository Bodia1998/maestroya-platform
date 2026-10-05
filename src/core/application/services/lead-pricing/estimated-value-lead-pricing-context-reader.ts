import type { JobValueEstimationContextReader } from "@/application/ports/job-value-estimation-context-reader";
import type { LeadPricingContextReader } from "@/application/ports/lead-pricing-context-reader";
import type { LeadPricingContext } from "@/domain/services/lead-pricing";
import { estimateJobValue, type JobValueEstimationConfig } from "@/domain/services/job-value-estimation";

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
 */
export class EstimatedValueLeadPricingContextReader implements LeadPricingContextReader {
  constructor(
    private readonly contexts: JobValueEstimationContextReader,
    private readonly config: JobValueEstimationConfig,
  ) {}

  async findByLeadId(leadId: string): Promise<LeadPricingContext | null> {
    const context = await this.contexts.findByLeadId(leadId);
    if (!context) return null;
    const estimate = estimateJobValue(context, this.config);
    return {
      flowVersion: context.flowVersion,
      categorySlug: context.categorySlug,
      parentCategorySlug: context.parentCategorySlug,
      urgency: context.urgency,
      estimatedServiceValue:
        estimate.status === "ESTIMATED"
          ? { amount: estimate.estimatedServiceValue, currency: estimate.currency, confidence: estimate.confidence }
          : null,
    };
  }
}
