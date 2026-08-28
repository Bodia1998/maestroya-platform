import type { CreditNoteStatusValue } from "@/domain/repositories/credit-note-repository";

/**
 * Module 79 — Invoicing & Credit Notes: the state machine for
 * `CreditNote.status`, mirroring `invoice-lifecycle.ts`'s own shape at a
 * smaller scale — a credit note is created as DRAFT (its numbers already
 * final, since they are derived once via `calculateTaxReversal` and never
 * revised) and immediately issuable; CANCELLED exists only for the
 * "created by mistake, never actually issued" case. Once ISSUED, a credit
 * note is itself immutable — a credit note is never corrected by another
 * edit, only (in a future accounting period) by its own credit note if
 * the business model ever requires that; this module does not implement
 * "credit notes on credit notes."
 */
const TRANSITIONS: Readonly<Record<CreditNoteStatusValue, readonly CreditNoteStatusValue[]>> = {
  DRAFT: ["ISSUED", "CANCELLED"],
  ISSUED: [],
  CANCELLED: [],
};

export function canTransitionCreditNoteStatus(from: CreditNoteStatusValue, to: CreditNoteStatusValue): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function isImmutableCreditNoteStatus(status: CreditNoteStatusValue): boolean {
  return status === "ISSUED";
}
