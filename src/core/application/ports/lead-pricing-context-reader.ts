import type { LeadPricingContext } from "@/domain/services/lead-pricing";

/**
 * Module 128 — read port that supplies the minimum, pricing-only context for
 * a Lead. The context type carries no customer id, contact, street address or
 * coordinates, so an adapter cannot leak them through this port.
 *
 * `null` = the Lead does not exist. Adapters must never invent a value:
 * `estimatedServiceValue: null` means "no job-value source exists".
 */
export interface LeadPricingContextReader {
  findByLeadId(leadId: string): Promise<LeadPricingContext | null>;
}
