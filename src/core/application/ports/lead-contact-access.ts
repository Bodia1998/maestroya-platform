import type { LeadContactAuthorizationFacts } from "@/domain/services/lead-contact-access-policy";

/**
 * Module 122 — ports Module 123+ must implement against the real
 * Lead / LeadPurchase tables. Nothing implements them yet: until then no
 * production code path can reach private lead contact data (deny by
 * construction, not by a flag).
 */

/** Authorization-side read. Must NOT select any customer contact column. */
export interface LeadContactAuthorizationReader {
  /**
   * Facts about (lead, professional). Scoped to `professionalProfileId`: the
   * adapter must only ever surface that professional's own authorization.
   * `null` when the lead does not exist.
   */
  findFacts(leadId: string, professionalProfileId: string): Promise<LeadContactAuthorizationFacts | null>;
}

/**
 * Raw private contact projection. Deliberately a minimal explicit column
 * list (not a customer/user aggregate), so unrelated sensitive fields
 * (passwordHash, tax data, notes, internal ids) can never ride along.
 */
export interface LeadContactRecord {
  customerDisplayName: string | null;
  email: string | null;
  phone: string | null;
  addressLine1: string;
  addressLine2: string | null;
  postalCode: string;
  city: string;
  province: string | null;
}

/** Private-data read. Called by GetLeadContactUseCase ONLY after the
 *  policy allowed access. No other caller may use this port. */
export interface LeadContactReader {
  readContact(leadId: string): Promise<LeadContactRecord | null>;
}
