import type { LeadPublicationPriceOutcome } from "@/domain/services/lead-publication";

/**
 * Module 133 — read port that supplies the production price outcome used by
 * the publication contract. The adapter runs the Module 129 estimate and the
 * Module 128 engine with the Module 132 production configuration and reports
 * the raw result together with the configuration identity that produced it.
 *
 * Fail closed: no valid production configuration -> `CONFIGURATION_UNAVAILABLE`.
 * Implementations never fall back to another configuration, never invent a
 * price and never persist anything. The publication gate decides what is
 * publishable.
 */
export interface LeadPublicationPriceSource {
  priceForLead(leadId: string): Promise<LeadPublicationPriceOutcome>;
}
