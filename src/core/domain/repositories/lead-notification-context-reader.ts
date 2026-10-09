import type { LeadPurchaseStatus } from "@/domain/services/lead-purchase";

/**
 * Module 145 — the ONLY facts a LEAD_V1 notification may be built from, read
 * server-side from the persisted relations
 *   LeadPurchase -> Lead -> ServiceRequest -> CustomerProfile -> User
 *   LeadPurchase -> ProfessionalProfile -> User
 * Every recipient id here is a `User.id` taken from those relations — never from
 * an event payload, a client value, a URL, or M138 contact data.
 *
 * The shape is a deliberate whitelist: it has no phone, email, name, address,
 * postal code, title/description (free text the customer may have put contact
 * data into), payment reference, Stripe id or purchase id. `city` is the same
 * granularity the Lead Feed v2 already shows every eligible professional.
 *
 * Both readers return `null` unless the lead's flow is LEAD_V1, so a legacy
 * quote/payment record can never produce a LEAD_V1 notification even if an event
 * were mis-published for it.
 */
export interface LeadNotificationContext {
  /** Lead.id — safe: it is the identifier the professional marketplace URLs already use. */
  leadId: string;
  /** ServiceRequest.id — only ever put in the OWNING CUSTOMER's own deep link. */
  serviceRequestId: string;
  /** User.id of the request's owner (the customer). */
  customerUserId: string;
  /** Marketplace-public location granularity. */
  city: string;
}

export interface LeadPurchaseNotificationContext extends LeadNotificationContext {
  /** User.id of the professional who owns the purchase. */
  professionalUserId: string;
  /** The persisted purchase status at read time (the authoritative gate). */
  purchaseStatus: LeadPurchaseStatus;
}

export interface LeadNotificationContextReader {
  /** A LEAD_V1 lead (any status), or null. The subscriber additionally requires PUBLISHED. */
  findForLead(leadId: string): Promise<(LeadNotificationContext & { leadStatus: string }) | null>;
  /** A purchase of a LEAD_V1 lead, or null. */
  findForPurchase(purchaseId: string): Promise<LeadPurchaseNotificationContext | null>;
}
