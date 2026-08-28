import { CreditNoteExceedsRemainingAmountError } from "@/domain/errors/domain-error";
import { roundToCents } from "@/domain/services/money";

/**
 * Module 79 — Invoicing & Credit Notes: pure domain rule for "how much of
 * this invoice may still be credited" — kept as a small, dependency-free
 * function (same style as `money.ts`) so `CreateCreditNoteUseCase` never
 * re-derives this arithmetic itself and a future admin tool needing the
 * same figure (e.g. "remaining creditable amount" on an invoice detail
 * screen) can call it directly without going through a use case.
 *
 * The module brief explicitly requires preventing "a credit note
 * exceeding the remaining creditable amount, unless the existing business
 * model explicitly permits it" — MaestroYa's business model does not
 * define such an exception anywhere in this codebase, so this function
 * always enforces the cap; a future confirmed exception would be a new,
 * explicit parameter here, never a bypass at the call site.
 */
export function computeRemainingCreditableAmount(
  invoiceTotalAmount: number,
  alreadyCreditedAmount: number,
): number {
  return roundToCents(Math.max(0, invoiceTotalAmount - alreadyCreditedAmount));
}

/** Throws `CreditNoteExceedsRemainingAmountError` if `requestedAmount`
 *  would push the total credited against this invoice above its own
 *  total. Never mutates anything — purely a guard the use case calls
 *  before persisting. */
export function assertCreditNoteWithinRemainingAmount(
  invoiceTotalAmount: number,
  alreadyCreditedAmount: number,
  requestedAmount: number,
): void {
  const remaining = computeRemainingCreditableAmount(invoiceTotalAmount, alreadyCreditedAmount);
  if (roundToCents(requestedAmount) > remaining) {
    throw new CreditNoteExceedsRemainingAmountError(
      `Requested credit note amount (${requestedAmount.toFixed(2)}) exceeds the remaining creditable amount ` +
        `(${remaining.toFixed(2)}) for this invoice (total ${invoiceTotalAmount.toFixed(2)}, already credited ${alreadyCreditedAmount.toFixed(2)}).`,
    );
  }
}
