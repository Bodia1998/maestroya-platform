/**
 * Module 22 — Commission & Financial: read-focused repository interface
 * for the existing, previously-unused `Payment` model (see schema.prisma's
 * own doc comment). Deliberately does NOT expose create/capture/authorize
 * methods — creating and capturing a Payment is Module 12 (Payment/Stripe
 * Connect)'s job, driven by a real Stripe PaymentIntent; this module only
 * ever *reads* an already-captured Payment to calculate and record its
 * commission breakdown. When Module 12 is implemented, it is expected to
 * either extend this interface with its own write methods or introduce a
 * sibling write-side interface — either way, this file is not duplicated.
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
}
