/**
 * Module 163 — read port for the structured scope stored with a Lead's
 * ServiceRequest. What comes back is UNTRUSTED storage content: the consumer
 * re-validates the answers against the questionnaire definition before using
 * them (a stored value is never assumed to still be valid).
 *
 * `null` = the Lead does not exist, or its request has no stored structured
 * scope. The type carries nothing but the questionnaire version and the
 * answers — no budget, customer, contact, address or free text.
 */
export interface StoredLeadScope {
  questionnaireVersion: string;
  answers: unknown;
}

export interface LeadScopeAnswersReader {
  findByLeadId(leadId: string): Promise<StoredLeadScope | null>;
}
