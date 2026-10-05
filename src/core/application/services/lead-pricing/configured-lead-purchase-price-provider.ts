import type { LeadPricingContextReader } from "@/application/ports/lead-pricing-context-reader";
import type { LeadPurchasePrice, LeadPurchasePriceProvider } from "@/application/ports/lead-purchase-price-provider";
import { LeadPricingUnavailableError, calculateLeadPrice, type LeadPricingConfig } from "@/domain/services/lead-pricing";

/**
 * Module 128 — concrete LeadPurchasePriceProvider (V1).
 *
 * Reads the pricing-only context, runs the pure deterministic engine with the
 * injected configuration, and returns `{ price, currency }`. Anything other
 * than a PRICED result throws LeadPricingUnavailableError (fail closed):
 * InitiateLeadPurchaseUseCase maps that to its fixed LeadPurchasePricingError
 * and persists nothing. This class creates no LeadPurchase and has no
 * payment, tax or contact dependency.
 *
 * The `number` returned is the existing LeadPurchasePrice boundary
 * convention (2-decimal EUR). It is produced from the engine's exact decimal
 * string, not from floating-point arithmetic.
 */
export class ConfiguredLeadPurchasePriceProvider implements LeadPurchasePriceProvider {
  constructor(
    private readonly contexts: LeadPricingContextReader,
    private readonly config: LeadPricingConfig,
  ) {}

  async getPriceForLead(leadId: string): Promise<LeadPurchasePrice> {
    const context = await this.contexts.findByLeadId(leadId);
    if (!context) throw new LeadPricingUnavailableError("UNPRICED", "LEAD_NOT_FOUND");
    const result = calculateLeadPrice(context, this.config);
    if (result.status !== "PRICED") throw new LeadPricingUnavailableError(result.status, result.reason);
    return { price: Number(result.price), currency: result.currency };
  }
}
