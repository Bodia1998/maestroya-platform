import { DomainError } from "@/domain/errors/domain-error";
import type { TransactionFlowVersion } from "@/domain/services/transaction-flow";

/**
 * Module 122 — Contact Protection & Access Security.
 *
 * Pure, deny-by-default decision: "may THIS professional read THIS lead's
 * private customer contact data?" It is evaluated purely on server-side
 * facts (see LeadContactAuthorizationFacts) and never on anything the
 * caller supplied beyond the lead id.
 *
 * Lead / LeadPurchase do not exist yet (Module 123+). This policy therefore
 * depends on a deliberately tiny, entity-agnostic fact shape that the future
 * LeadPurchase adapter must map onto — see
 * MODULE_122_CONTACT_PROTECTION_ACCESS_SECURITY_AUDIT.md §10.
 */

/**
 * State of the access authorization (the future confirmed LeadPurchase).
 * ONLY "CONFIRMED" ever grants access. The adapter must map every other
 * purchase state (pending payment, failed payment, refunded, cancelled,
 * disputed, unknown) onto a non-CONFIRMED value; the policy additionally
 * treats any unrecognised string as a denial.
 */
export type LeadContactGrantState = "CONFIRMED" | "PENDING" | "REVOKED" | "INVALID";

export interface LeadContactAuthorizationFacts {
  /** False / absent lead -> denied. */
  leadExists: boolean;
  /** Flow of the ServiceRequest behind the lead. Only LEAD_V1 may unlock contact. */
  flowVersion: TransactionFlowVersion;
  /** Null = no authorization row exists for this (professional, lead). */
  grant: {
    state: LeadContactGrantState;
    /** ProfessionalProfile id the authorization belongs to. Re-checked here
     *  even though the reader is already scoped to the professional, so a
     *  buggy adapter cannot hand over another professional's grant. */
    professionalProfileId: string;
  } | null;
  /** Any other server-side block (restriction, dispute freeze, ...). */
  blocked: boolean;
}

export type LeadContactDenialReason =
  | "LEAD_NOT_FOUND"
  | "WRONG_FLOW"
  | "NO_GRANT"
  | "GRANT_NOT_CONFIRMED"
  | "GRANT_BELONGS_TO_OTHER_PROFESSIONAL"
  | "BLOCKED";

export type LeadContactAccessDecision =
  | { allowed: true }
  | { allowed: false; reason: LeadContactDenialReason };

export function canProfessionalAccessLeadContact(
  facts: LeadContactAuthorizationFacts | null,
  professionalProfileId: string,
): LeadContactAccessDecision {
  if (!facts || !facts.leadExists) return { allowed: false, reason: "LEAD_NOT_FOUND" };
  if (facts.flowVersion !== "LEAD_V1") return { allowed: false, reason: "WRONG_FLOW" };
  if (facts.blocked !== false) return { allowed: false, reason: "BLOCKED" };
  if (!facts.grant) return { allowed: false, reason: "NO_GRANT" };
  if (facts.grant.professionalProfileId !== professionalProfileId) {
    return { allowed: false, reason: "GRANT_BELONGS_TO_OTHER_PROFESSIONAL" };
  }
  if (facts.grant.state !== "CONFIRMED") return { allowed: false, reason: "GRANT_NOT_CONFIRMED" };
  return { allowed: true };
}

/**
 * The ONLY error a caller sees for every denial (bad input, not a
 * professional, no lead, wrong flow, no/pending/revoked grant, someone
 * else's grant, blocked). Fixed message, no ids, no reason — so a denied
 * caller cannot tell "lead does not exist" from "you did not buy it" from
 * "contact data exists". The precise reason goes to the server log only.
 */
export class LeadContactAccessDeniedError extends DomainError {
  readonly code = "LEAD_CONTACT_ACCESS_DENIED";

  constructor() {
    super("You do not have access to this contact information.");
  }
}
