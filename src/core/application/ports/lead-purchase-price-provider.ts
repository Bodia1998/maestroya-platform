/**
 * Module 126 — the fee a professional pays MaestroYa for access to a Lead.
 *
 * This is ONLY a boundary. Module 126 does NOT decide prices: no pricing
 * engine, no category/urgency/market factors, no job-value estimation. A
 * later module implements this port; until then nothing in production
 * composes InitiateLeadPurchaseUseCase (no price source exists).
 *
 * The price is resolved SERVER-SIDE from the lead id — a client-supplied
 * price is never accepted. Amounts follow the repository money convention
 * (plain decimal with <= 2 fraction digits + ISO currency, see
 * domain/services/lead-purchase.ts); no floating-point arithmetic happens here.
 */
export interface LeadPurchasePrice {
  price: number;
  currency: string;
}

export interface LeadPurchasePriceProvider {
  getPriceForLead(leadId: string): Promise<LeadPurchasePrice>;
}
