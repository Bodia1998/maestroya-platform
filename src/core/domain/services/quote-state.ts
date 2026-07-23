import type { QuoteStatusValue } from "@/domain/repositories/quote-repository";

/**
 * Offers/Quotes module — Quote state-transition rules, kept as a small
 * dependency-free domain helper (same style as service-request-state.ts and
 * geo-distance.ts) rather than inlined checks scattered across use cases,
 * so "what counts as editable / withdrawable" has exactly one definition.
 *
 * Business/schema reconciliation: the existing `QuoteStatus` enum is
 * PENDING, SENT, VIEWED, ACCEPTED, REJECTED, EXPIRED, WITHDRAWN — richer
 * than this module's scope (professional-side quote management + the
 * customer-side viewing needed for the next workflow stage; acceptance,
 * scheduling, and expiry are explicitly out of scope here).
 *
 * Decision — initial status: same reasoning as
 * service-request-state.ts's OPEN/PUBLISHED note — this MVP has no
 * separate draft-save step for a Quote. CreateQuoteUseCase both creates and
 * immediately submits the quote to the customer, so a quote is created with
 * status = SENT. PENDING is left untouched for a possible future
 * draft-save workflow; this module never sets or reads it as a live state.
 *
 * Decision — editable/withdrawable statuses: SENT and VIEWED are the two
 * "awaiting the customer's decision" states — a quote the professional can
 * still revise or pull back. Once the customer has ACCEPTED or REJECTED it,
 * or it has EXPIRED, or the professional has already WITHDRAWN it, the
 * quote is treated as terminal — no further edits or withdrawals are
 * possible, enforced here in the domain layer so no use case or UI path can
 * bypass it.
 *
 * Decision — supported transitions: this module implements
 * (SENT | VIEWED) -> WITHDRAWN, driven by WithdrawQuoteUseCase.
 *
 * Quote acceptance is intentionally not represented as a generic quote state
 * transition. AcceptQuoteUseCase performs acceptance as a dedicated atomic
 * workflow: the selected quote becomes ACCEPTED, competing open quotes become
 * REJECTED, the ServiceRequest becomes ACCEPTED, and an Appointment is created.
 * This keeps the multi-entity acceptance invariant inside the dedicated
 * acceptance workflow rather than allowing individual quote state transitions
 * to bypass it.
 *
 * EXPIRED remains unimplemented — no use case in this codebase sets it yet.
 */
export const INITIAL_QUOTE_STATUS: QuoteStatusValue = "SENT";
export const WITHDRAWN_QUOTE_STATUS: QuoteStatusValue = "WITHDRAWN";
export const ACCEPTED_QUOTE_STATUS: QuoteStatusValue = "ACCEPTED";
export const REJECTED_QUOTE_STATUS: QuoteStatusValue = "REJECTED";

/** The two "awaiting customer decision" statuses — see module doc above. */
export const OPEN_QUOTE_STATUSES: readonly QuoteStatusValue[] = ["SENT", "VIEWED"];

export function isEditableQuoteStatus(status: QuoteStatusValue): boolean {
  return OPEN_QUOTE_STATUSES.includes(status);
}

export function isWithdrawableQuoteStatus(status: QuoteStatusValue): boolean {
  return OPEN_QUOTE_STATUSES.includes(status);
}

/** Whether a customer may accept this quote — same "awaiting decision" set
 *  as editable/withdrawable (SENT/VIEWED). A WITHDRAWN, REJECTED, EXPIRED,
 *  or already-ACCEPTED quote can never be (re-)accepted. */
export function isAcceptableQuoteStatus(status: QuoteStatusValue): boolean {
  return OPEN_QUOTE_STATUSES.includes(status);
}

/** "Active" = counts toward the "one active quote per request" rule
 *  enforced by CreateQuoteUseCase (see QuoteRepository.findActiveByServiceRequestAndProfessional). */
export function isActiveQuoteStatus(status: QuoteStatusValue): boolean {
  return OPEN_QUOTE_STATUSES.includes(status);
}

/** Whether transitioning a quote from `from` to `to` is a transition this
 *  module is allowed to perform. See "Decision — supported transitions" above. */
export function canTransitionQuoteStatus(
  from: QuoteStatusValue,
  to: QuoteStatusValue,
): boolean {
  if (to === WITHDRAWN_QUOTE_STATUS) {
    return OPEN_QUOTE_STATUSES.includes(from);
  }

  return false;
}
