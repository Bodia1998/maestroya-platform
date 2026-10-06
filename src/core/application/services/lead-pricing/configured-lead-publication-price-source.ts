import type { JobValueEstimationContextReader } from "@/application/ports/job-value-estimation-context-reader";
import type { LeadPublicationPriceSource } from "@/application/ports/lead-publication-price-source";
import { EstimatedValueLeadPricingContextReader } from "@/application/services/lead-pricing/estimated-value-lead-pricing-context-reader";
import { calculateLeadPrice } from "@/domain/services/lead-pricing";
import type { LeadPricingConfigResolution } from "@/domain/services/lead-pricing-production-config";
import type { LeadPublicationPriceOutcome } from "@/domain/services/lead-publication";

/**
 * Module 133 — LeadPublicationPriceSource backed by the Module 132 production
 * configuration. Mirrors ConfiguredLeadPurchasePriceProvider (same estimator
 * + engine, same configuration object) but reports the FULL result and the
 * configuration identity instead of throwing, so the publication gate — not
 * this adapter — decides what may be published.
 *
 * Takes the (already classified) Module 132 resolution: anything other than
 * VALID yields CONFIGURATION_UNAVAILABLE and the engine is never run. There is
 * no retry with another configuration.
 */
export class ConfiguredLeadPublicationPriceSource implements LeadPublicationPriceSource {
  constructor(
    private readonly contexts: JobValueEstimationContextReader,
    private readonly configuration: LeadPricingConfigResolution,
  ) {}

  async priceForLead(leadId: string): Promise<LeadPublicationPriceOutcome> {
    if (this.configuration.status !== "VALID") return { kind: "CONFIGURATION_UNAVAILABLE" };
    const config = this.configuration.config;
    const reader = new EstimatedValueLeadPricingContextReader(this.contexts, config.jobValue);
    const context = await reader.findByLeadId(leadId);
    const result = context
      ? calculateLeadPrice(context, config.leadPricing)
      : ({ status: "UNPRICED", reason: "LEAD_NOT_FOUND", ruleVersion: config.leadPricing.ruleVersion } as const);
    return { kind: "RESOLVED", configVersion: config.configVersion, jobValueRuleVersion: config.jobValue.ruleVersion, result };
  }
}
