/**
 * Module 143 seam, wired by Module 144 — where a marketplace card's "buy" call to action
 * navigates: the professional checkout page for that lead.
 *
 * The lead id is only a lookup key for the page. The marketplace never calls a purchase or
 * payment action itself, never creates a purchase and never implies one happened: all of that
 * happens on the checkout page, behind the session-checked server boundaries.
 */
export function getLeadPurchaseHref(leadId: string): string | null {
  if (typeof leadId !== "string" || leadId === "") return null;
  return `/dashboard/professional/leads/${encodeURIComponent(leadId)}/purchase`;
}
