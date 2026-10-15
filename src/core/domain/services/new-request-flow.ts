import { DomainError } from "@/domain/errors/domain-error";
import { DEFAULT_TRANSACTION_FLOW_VERSION, type TransactionFlowVersion } from "@/domain/services/transaction-flow";

/**
 * Module 165 — LEAD_V1 default cutover: the pure, deterministic rule that decides which flow a NEW customer service request is
 * created in.
 *
 * It is a view over two things that already exist and adds no switch of its own:
 *   - the M159 ENTRY rollout area (`LEAD_V1_ROLLOUT_MODE` = ENTRY_ONLY | ENABLED opens it);
 *   - the M132 pilot category support (`isLeadRequestCategorySupported`), the single authority on what LEAD_V1 can price.
 *
 * LEAD_V1 is selected ONLY when both are affirmatively true (strict `=== true`). Everything else - area closed, category not
 * supported, an unreadable or invalid configuration, a malformed input - selects the pre-M165 default (LEGACY_QUOTE_PAYMENT). The
 * rule therefore can never route a request into LEAD_V1 that the M159 guard, the M132 pilot list or the M142 submission pipeline
 * would refuse, and "off" has exactly the behaviour the platform had before M165.
 *
 * This rule only chooses the ENTRY for NEW requests. It never reads or rewrites an existing request: the persisted
 * `ServiceRequest.flowVersion` stays the single source of truth for every later operation (publication, pricing, purchase, contact
 * protection, payments, the M121/M131 legacy guard).
 */
export const NEW_REQUEST_FLOW_REASONS = ["LEAD_V1_DEFAULT", "ENTRY_CLOSED", "CATEGORY_NOT_ELIGIBLE"] as const;
export type NewRequestFlowReason = (typeof NEW_REQUEST_FLOW_REASONS)[number];

export interface NewRequestFlowDecision {
  readonly flow: TransactionFlowVersion;
  readonly reason: NewRequestFlowReason;
}

export interface NewRequestFlowFacts {
  /** The M159 ENTRY area is open. */
  readonly entryOpen: unknown;
  /** The category is supported by the M132 pilot configuration. */
  readonly categoryEligible: unknown;
}

const LEGACY_ENTRY_CLOSED: NewRequestFlowDecision = { flow: DEFAULT_TRANSACTION_FLOW_VERSION, reason: "ENTRY_CLOSED" };
const LEGACY_NOT_ELIGIBLE: NewRequestFlowDecision = { flow: DEFAULT_TRANSACTION_FLOW_VERSION, reason: "CATEGORY_NOT_ELIGIBLE" };
const LEAD_V1_DEFAULT: NewRequestFlowDecision = { flow: "LEAD_V1", reason: "LEAD_V1_DEFAULT" };

/** Total function: only `true` opens the cutover; any other value of either fact is the legacy default. */
export function selectNewRequestFlow(facts: NewRequestFlowFacts): NewRequestFlowDecision {
  if (facts.entryOpen !== true) return LEGACY_ENTRY_CLOSED;
  if (facts.categoryEligible !== true) return LEGACY_NOT_ELIGIBLE;
  return LEAD_V1_DEFAULT;
}

/**
 * Thrown by the legacy creation path when LEAD_V1 is the default for the chosen category. A distinct code (not a ValidationError)
 * so a caller can never mistake it for "fix the form and retry the same call". Nothing was created. The fixed message names neither
 * the rollout mode nor the pilot configuration.
 */
export class LegacyRequestCreationRedirectedError extends DomainError {
  readonly code = "LEGACY_REQUEST_CREATION_REDIRECTED";

  constructor() {
    super("This service is requested through the new request form.");
  }
}
