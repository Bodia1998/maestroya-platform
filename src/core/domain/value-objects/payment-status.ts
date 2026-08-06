/**
 * Module 35 — Payment Domain Model Preparation.
 *
 * The payment lifecycle's fixed vocabulary. Deliberately identical to the
 * Prisma `PaymentStatus` enum (`prisma/schema.prisma`, "Payments & Finance"
 * section) that Module 22 — Commission & Financial already reads through
 * `PaymentRepository`/`PrismaPaymentRepository` — that enum was sized for
 * "the planned Stripe integration and marketplace payment lifecycle"
 * exactly as this module's brief asks for, so this file mirrors it rather
 * than inventing a second, competing status vocabulary. Duplicated (not
 * imported from `@prisma/client`) because the domain layer must stay
 * framework-agnostic — no Prisma types leak in here — the same discipline
 * `PaymentRepository`'s own `PaymentStatusValue` already follows.
 *
 * - `PENDING` — created, no funds authorized or captured yet.
 * - `AUTHORIZED` — funds reserved with the gateway, not yet captured
 *   (Stripe Connect's `requires_capture` PaymentIntent state, once Module
 *   59 exists). Optional: a direct-capture flow can go PENDING -> CAPTURED
 *   without ever visiting this status.
 * - `CAPTURED` — funds actually taken. The trigger point Module 22's
 *   `RecordCommissionForPaymentUseCase` already documents itself as
 *   waiting for.
 * - `FAILED` — authorization or capture was declined/errored. Terminal.
 * - `CANCELLED` — abandoned before capture (customer cancelled, quote
 *   expired, ...). Terminal.
 * - `REFUNDED` — the full amount has been returned to the payer. Terminal.
 * - `PARTIALLY_REFUNDED` — some, but not all, of the amount has been
 *   returned. Not terminal — further refunds can still bring it to
 *   `REFUNDED`.
 *
 * No speculative states beyond this set (e.g. no separate "DISPUTED" —
 * Module 21 Disputes already models dispute outcomes against a Payment via
 * `FinancialAdjustment`, it doesn't need a mirrored Payment status).
 */
export const PAYMENT_STATUSES = [
  "PENDING",
  "AUTHORIZED",
  "CAPTURED",
  "FAILED",
  "CANCELLED",
  "REFUNDED",
  "PARTIALLY_REFUNDED",
] as const;

export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export function isPaymentStatus(value: unknown): value is PaymentStatus {
  return typeof value === "string" && (PAYMENT_STATUSES as readonly string[]).includes(value);
}

/**
 * Statuses from which the payment lifecycle cannot move further. `CAPTURED`
 * and `PARTIALLY_REFUNDED` are intentionally excluded — both can still
 * transition (to a refunded state) via `Payment.refund()`, which is handled
 * separately from `canTransitionPaymentStatus` below since a partial refund
 * can legitimately leave the status unchanged (`PARTIALLY_REFUNDED` ->
 * `PARTIALLY_REFUNDED`) rather than moving to a new node in the graph.
 */
const TERMINAL_STATUSES: ReadonlySet<PaymentStatus> = new Set(["FAILED", "CANCELLED", "REFUNDED"]);

export function isTerminalPaymentStatus(status: PaymentStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

/**
 * The allowed-transition graph for the `authorize`/`capture`/`fail`/
 * `cancel` operations on `Payment` (`domain/entities/payment.ts`).
 * Refund-driven transitions (`CAPTURED`/`PARTIALLY_REFUNDED` ->
 * `PARTIALLY_REFUNDED`/`REFUNDED`) are validated by `Payment.refund()`
 * itself against the refunded amount, not through this graph — which is
 * why every terminal status, plus `CAPTURED` and `PARTIALLY_REFUNDED`, map
 * to an empty transition list here.
 */
const ALLOWED_TRANSITIONS: Readonly<Record<PaymentStatus, readonly PaymentStatus[]>> = {
  PENDING: ["AUTHORIZED", "CAPTURED", "FAILED", "CANCELLED"],
  AUTHORIZED: ["CAPTURED", "FAILED", "CANCELLED"],
  CAPTURED: [],
  PARTIALLY_REFUNDED: [],
  FAILED: [],
  CANCELLED: [],
  REFUNDED: [],
};

export function canTransitionPaymentStatus(from: PaymentStatus, to: PaymentStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}
