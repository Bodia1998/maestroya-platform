/**
 * Module 22 — Commission & Financial: read-focused repository interface
 * for the existing, previously-unused `Payment` model (see schema.prisma's
 * own doc comment). Originally deliberately did NOT expose create/capture/
 * authorize methods — creating and capturing a Payment was documented as
 * "Module 12 (Payment/Stripe Connect)'s job," with this module only ever
 * *reading* an already-captured Payment to calculate and record its
 * commission breakdown, and an explicit invitation to "either extend this
 * interface with its own write methods or introduce a sibling write-side
 * interface — either way, this file is not duplicated" once that module
 * landed.
 *
 * Module 73 — Real Customer Payment Capture is that module. Per the
 * invitation above, this interface is extended in place (not duplicated)
 * with the minimum write-side surface the real payment lifecycle needs:
 * `create` (persists a Payment the instant a Stripe PaymentIntent has been
 * created for it — see `InitiateQuotePaymentUseCase`), `updateStatus` (the
 * one mutating operation for every subsequent transition — authorize/
 * capture/fail/cancel — all driven by `ProcessCustomerPaymentWebhookUseCase`),
 * and two new lookups (`findByStripePaymentIntentId`,
 * `findActiveByQuoteId`) the webhook handler and the idempotency check
 * need. Every pre-existing read method is unchanged.
 *
 * `jobId` is a derived/denormalized read (via Payment.quote.job), not a
 * stored column — see Job's own doc comment on "don't denormalize the
 * amount" and the Module 11 audit's note that Job is reached through
 * Quote, never given its own amount field. Same reasoning applies here:
 * rather than adding a `jobId` column to Payment, this repository resolves
 * it through the existing Payment -> Quote -> Job relation at read time.
 */

export type PaymentStatusValue =
  | "PENDING"
  | "AUTHORIZED"
  | "CAPTURED"
  | "FAILED"
  | "CANCELLED"
  | "REFUNDED"
  | "PARTIALLY_REFUNDED";

/** Mirrors the Prisma `PaymentMethodType` enum (schema.prisma) — see
 *  `payment-status.ts`'s own doc comment on why the domain/application
 *  layers duplicate rather than import Prisma's enum types directly.
 *  Module 73 only ever writes `"CARD"` (the only method
 *  `InitiateQuotePaymentUseCase` supports today); the others are declared
 *  for completeness/forward-compatibility with the existing column, not
 *  because this module writes them. */
export type PaymentMethodValue = "CARD" | "SEPA_DEBIT" | "BANK_TRANSFER" | "WALLET" | "OTHER";

/** Statuses a Payment is considered to still be "in play" for — i.e. not
 *  yet failed or cancelled. Used by `findActiveByQuoteId`'s own doc
 *  comment/callers to decide whether a new payment attempt may be started
 *  for a given Quote. */
export const ACTIVE_PAYMENT_STATUSES: readonly PaymentStatusValue[] = [
  "PENDING",
  "AUTHORIZED",
  "CAPTURED",
  "PARTIALLY_REFUNDED",
  "REFUNDED",
];

export interface PaymentRecord {
  id: string;
  serviceRequestId: string;
  quoteId: string | null;
  /** Resolved via quote.job.id — null if this Payment's Quote was never
   *  accepted (no Job exists yet) or if quoteId itself is null. */
  jobId: string | null;
  payerId: string;
  amount: number;
  currency: string;
  status: PaymentStatusValue;
  capturedAt: Date | null;
  /** Module 73 — the gateway's own charge identifier (Stripe
   *  `PaymentIntent.id`) — opaque, used only to correlate an inbound
   *  webhook event back to this Payment via `findByStripePaymentIntentId`.
   *  `null` only in the (currently unreachable, since `create` always
   *  requires one) case of a Payment that predates this column being
   *  populated. */
  stripePaymentIntentId: string | null;
  method: PaymentMethodValue;
  /** Set only when `status === "FAILED"` — the reason surfaced by
   *  `Payment.fail()`. */
  failureReason: string | null;
}

/**
 * Module 73 — the exact set of fields `InitiateQuotePaymentUseCase`
 * persists the instant a Stripe PaymentIntent exists for a payment
 * attempt — always in `PENDING` status; every later transition goes
 * through `updateStatus`, never a second `create` call.
 */
export interface CreatePaymentRecordData {
  /** Generated server-side (`randomUUID()`) before the gateway call, so
   *  the same id can be handed to `PaymentGateway.authorize` as metadata —
   *  see `PaymentAuthorizationRequest.paymentId`'s own doc comment. */
  id: string;
  serviceRequestId: string;
  quoteId: string;
  /** The authenticated User.id who is paying — matches
   *  `Payment.payerId`'s `User` relation (`"PaymentPayer"`), never a
   *  `CustomerProfile.id`. */
  payerId: string;
  amount: number;
  currency: string;
  method: PaymentMethodValue;
  stripePaymentIntentId: string;
}

/**
 * Module 73 — the single mutating operation every post-creation Payment
 * transition uses (`AUTHORIZED`/`CAPTURED`/`FAILED`/`CANCELLED`).
 * `fromStatuses` is a compare-and-swap guard, not a client-supplied
 * convenience — the caller (always `ProcessCustomerPaymentWebhookUseCase`,
 * having already validated the transition against the in-memory `Payment`
 * aggregate) states the status it observed the row in, and the
 * implementation MUST apply the write atomically only if the row's
 * *current* database status still matches one of `fromStatuses` at write
 * time (a single `UPDATE ... WHERE id = :id AND status IN (:fromStatuses)`,
 * never a separate read-then-write). This is what makes duplicate/
 * concurrent webhook delivery safe without a distributed lock: of two
 * concurrent deliveries racing to apply the same transition, exactly one
 * `UPDATE` can ever match the row, and `applied: false` on the loser tells
 * the caller "someone else already got there — treat this as a no-op,"
 * never silently double-processing (e.g. double-recording a
 * `PaymentCaptured` event). Mirrors
 * `ProfessionalOnboardingRepository.updateStripeConnectAccountIfNotStale`'s
 * own "fold the guard into the write" convention (Module 72).
 */
export interface UpdatePaymentStatusInput {
  id: string;
  fromStatuses: readonly PaymentStatusValue[];
  toStatus: PaymentStatusValue;
  capturedAt?: Date | null;
  failureReason?: string | null;
}

export interface UpdatePaymentStatusResult {
  /** `true` only if this call's own `UPDATE` actually matched and changed
   *  the row — see `UpdatePaymentStatusInput`'s own doc comment. */
  applied: boolean;
  /** The row's state *after* this call, whether or not `applied` is true
   *  — a caller that lost the race can still read the (now-current, set
   *  by whoever won) record without a second round trip. */
  record: PaymentRecord;
}

export interface PaymentRepository {
  findById(id: string): Promise<PaymentRecord | null>;
  findByJobId(jobId: string): Promise<PaymentRecord[]>;
  /** Customer-facing "my payments" listing — scoped to exactly one payer,
   *  never another customer's. */
  listForPayer(payerId: string): Promise<PaymentRecord[]>;
  /** Sum of PROCESSED Refunds against this Payment — used to compute
   *  "amount actually retained" for CustomerFinancialSummaryDTO. */
  sumProcessedRefunds(paymentId: string): Promise<number>;

  /**
   * Module 73 — the gateway-driven counterpart to `findById`: resolves a
   * Payment by the external charge id a webhook event carries.
   * `ProcessCustomerPaymentWebhookUseCase` is the sole caller — never
   * trusts any other event field to look up the Payment it should mutate.
   */
  findByStripePaymentIntentId(stripePaymentIntentId: string): Promise<PaymentRecord | null>;

  /**
   * Module 73 — the fast-path idempotency check `InitiateQuotePaymentUseCase`
   * runs before ever calling the gateway: is there already a Payment for
   * this Quote in one of `ACTIVE_PAYMENT_STATUSES`? A `CAPTURED`/
   * `PARTIALLY_REFUNDED`/`REFUNDED` result means the quote has already
   * been paid — the use case must refuse a second attempt outright. A
   * `PENDING`/`AUTHORIZED` result means an attempt is already in flight —
   * the use case is still safe to proceed (the deterministic Stripe
   * idempotency key plus this repository's own `create` upsert behavior
   * converge on the same row either way), but skips this check only as a
   * defensive fast path, never as the sole protection — see
   * `InitiateQuotePaymentUseCase`'s own doc comment for the full layered
   * concurrency story. Returns `null` if every Payment on this Quote (if
   * any) is `FAILED`/`CANCELLED` — a fresh attempt is always allowed then.
   */
  findActiveByQuoteId(quoteId: string): Promise<PaymentRecord | null>;

  /**
   * Persists a brand-new Payment in `PENDING` status, the instant a
   * Stripe PaymentIntent exists for it. MUST be implemented as an upsert
   * keyed on the *unique* `stripePaymentIntentId` column (never a plain
   * `INSERT`): because `PaymentGateway.authorize` is called with a
   * deterministic idempotency key derived from the Quote being paid (see
   * `PaymentAuthorizationRequest.idempotencyKey`'s own doc comment), two
   * concurrent `InitiateQuotePaymentUseCase` executions for the same Quote
   * can both receive the *same* `stripePaymentIntentId` back from Stripe
   * and both call `create` with it — the database's own uniqueness
   * constraint (not application code) must be what guarantees only one
   * Payment row ever results, with the second caller transparently
   * receiving the first caller's row back rather than a uniqueness-
   * violation error.
   */
  create(data: CreatePaymentRecordData): Promise<PaymentRecord>;

  /** See `UpdatePaymentStatusInput`/`UpdatePaymentStatusResult`'s own doc
   *  comments for the full compare-and-swap contract. */
  updateStatus(input: UpdatePaymentStatusInput): Promise<UpdatePaymentStatusResult>;
}
