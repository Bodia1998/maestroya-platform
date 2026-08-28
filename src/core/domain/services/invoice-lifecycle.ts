import type { InvoiceStatusValue } from "@/domain/repositories/invoice-repository";

/**
 * Module 79 — Invoicing & Credit Notes: the ONE explicit state machine for
 * `Invoice.status` — same "domain-level state machine, never scattered
 * status checks in controllers/use cases" convention `quote-state.ts`/
 * `job-state.ts`/`dispute-state.ts` already establish.
 *
 * DRAFT -> PENDING_ACCEPTANCE -> ACCEPTED -> ISSUED -> PAID
 * DRAFT -> CANCELLED
 * PENDING_ACCEPTANCE -> CANCELLED
 *
 * Rules (see the module brief's "INVOICE LIFECYCLE" section):
 *  - DRAFT may still be modified (this module models "modified" as
 *    "recreated" — see `CreateProfessionalInvoiceDraftUseCase`'s own doc
 *    comment on why there is no separate "UpdateInvoiceDraft" use case;
 *    nothing here forbids one being added later within the same DRAFT
 *    status).
 *  - PENDING_ACCEPTANCE may be reviewed/accepted (or cancelled, e.g. the
 *    professional never registered self-billing after all).
 *  - ACCEPTED must retain acceptance evidence — enforced by
 *    `InvoiceRepository.accept` always writing it atomically with the
 *    status change, never as a separate step.
 *  - ISSUED is immutable — no transition FROM `ISSUED` exists in this
 *    table except to `PAID`; there is no ISSUED -> DRAFT/ACCEPTED
 *    "un-issue" path at all. A correction after ISSUED must be a
 *    CreditNote (Module 79's own `CreateCreditNoteUseCase`), never an
 *    edit of this row.
 *  - PAID represents financial settlement and is terminal — no
 *    transition FROM `PAID` exists in this table.
 *  - CANCELLED is only reachable from DRAFT/PENDING_ACCEPTANCE and is
 *    terminal.
 *
 * Every other (from, to) pair — including any (status, status) no-op —
 * is invalid and must throw `InvalidInvoiceTransitionError` at the call
 * site (`canTransitionInvoiceStatus` returning `false`, not a silent
 * pass-through).
 */
const TRANSITIONS: Readonly<Record<InvoiceStatusValue, readonly InvoiceStatusValue[]>> = {
  DRAFT: ["PENDING_ACCEPTANCE", "CANCELLED"],
  PENDING_ACCEPTANCE: ["ACCEPTED", "CANCELLED"],
  ACCEPTED: ["ISSUED"],
  ISSUED: ["PAID"],
  PAID: [],
  CANCELLED: [],
};

export function canTransitionInvoiceStatus(from: InvoiceStatusValue, to: InvoiceStatusValue): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

/** Once `ISSUED` (or later), no financial field, party, line item, or the
 *  invoice number itself may ever change — see the module brief's
 *  "DOCUMENT IMMUTABILITY" section. Used by the domain/application layer
 *  to reject any mutation attempt (other than the ISSUED -> PAID status
 *  write, which touches no financial field) before it ever reaches a
 *  repository call. */
export function isImmutableInvoiceStatus(status: InvoiceStatusValue): boolean {
  return status === "ISSUED" || status === "PAID";
}

/** Whether an Invoice's financial content may still be edited/regenerated
 *  — the direct complement of `isImmutableInvoiceStatus`, kept as its own
 *  named predicate (rather than `!isImmutableInvoiceStatus(status)`) so
 *  call sites read as an intent ("can I still edit this") rather than a
 *  double negative. */
export function isEditableInvoiceStatus(status: InvoiceStatusValue): boolean {
  return status === "DRAFT";
}

/** Whether an Invoice is in a status a credit note may reference — a
 *  correction only ever makes sense against a financially "live"
 *  document (see `domain/services/credit-note-eligibility.ts`). */
export function isCreditableInvoiceStatus(status: InvoiceStatusValue): boolean {
  return status === "ISSUED" || status === "PAID";
}

/** Whether an Invoice's state satisfies the module brief's
 *  "INVOICE/PAYOUT RELATIONSHIP" prerequisite — see
 *  `CheckInvoiceRequiredForPayoutUseCase`'s own doc comment for exactly
 *  where this is consulted. Kept here (not duplicated in the payout
 *  module) so the "which invoice states let a payout proceed" rule has
 *  exactly one definition.
 *
 *  Deliberately requires ISSUED (or later), not merely ACCEPTED — the
 *  module brief's own flow chart places "invoice becomes immutable/
 *  issued" as the step immediately before "payout can proceed," and only
 *  ISSUED (never ACCEPTED) is numbered/immutable. An ACCEPTED-but-not-
 *  yet-ISSUED invoice has not finished the lifecycle step the brief
 *  requires before a payout may execute. */
export function satisfiesPayoutInvoicePrerequisite(status: InvoiceStatusValue | null): boolean {
  return status === "ISSUED" || status === "PAID";
}
