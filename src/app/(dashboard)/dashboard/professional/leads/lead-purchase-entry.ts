/**
 * Module 143 — the single seam between the lead marketplace and the future
 * purchase flow (Module 144).
 *
 * Returns where a card's "buy" call to action should navigate, or `null` while
 * no purchase route exists. The marketplace then renders the CTA disabled: it
 * never calls a payment/purchase action, never creates a purchase and never
 * implies a purchase happened. Module 144 changes this one function (e.g. to
 * `/dashboard/professional/leads/${leadId}/purchase`) and nothing else here.
 */
export function getLeadPurchaseHref(leadId: string): string | null {
  void leadId;
  return null;
}
