import type { LeadPricingRegion } from "@/domain/services/spain-pricing-territory";

/**
 * Module 164 — read port that tells the pricing layer WHERE a Lead's request is, as a two-digit province code only.
 *
 * The adapter reads the request's address facts it needs (country, postal code) and returns just the derived
 * `LeadPricingRegion`. The street, the city, the postal code and the coordinates never cross this port, so the pricing layer
 * (like the estimation context readers before it) cannot leak them.
 *
 * `null` = the Lead does not exist.
 */
export interface LeadPricingRegionReader {
  findByLeadId(leadId: string): Promise<LeadPricingRegion | null>;
}
