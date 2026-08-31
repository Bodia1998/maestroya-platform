/**
 * Module 86 — Stripe Chargeback & Dispute Handling: repository interface
 * for the new `StripeDispute` model (see schema.prisma's own doc comment
 * on that model for why it is a deliberately separate concept from
 * `DisputeRepository`'s `Dispute`). The single write/read boundary
 * `ProcessStripeDisputeWebhookUseCase` depends on — no Stripe SDK type
 * appears here, matching every other repository interface in this
 * codebase.
 */

export type StripeDisputeStatusValue = "NEEDS_RESPONSE" | "UNDER_REVIEW" | "WON" | "LOST" | "WARNING_CLOSED";

export interface StripeDisputeRecord {
  id: string;
  stripeDisputeId: string;
  stripeChargeId: string | null;
  stripePaymentIntentId: string | null;
  paymentId: string | null;
  jobId: string | null;
  amount: number;
  currency: string;
  reason: string | null;
  status: StripeDisputeStatusValue;
  evidenceDueBy: Date | null;
  financialAdjustmentId: string | null;
  closedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface UpsertStripeDisputeData {
  stripeDisputeId: string;
  stripeChargeId: string | null;
  stripePaymentIntentId: string | null;
  paymentId: string | null;
  jobId: string | null;
  amount: number;
  currency: string;
  reason: string | null;
  status: StripeDisputeStatusValue;
  evidenceDueBy: Date | null;
}

export interface MarkStripeDisputeClosedInput {
  id: string;
  status: "WON" | "LOST" | "WARNING_CLOSED";
  /** Set only for a `LOST` outcome, once the corresponding refund-type
   *  `FinancialAdjustment` has actually been created — `null` for
   *  `WON`/`WARNING_CLOSED`, which never create one. Passed explicitly
   *  (not derived) so a caller that already knows there is nothing to
   *  record never needs a second no-op write. */
  financialAdjustmentId: string | null;
}

export interface StripeDisputeRepository {
  findByStripeDisputeId(stripeDisputeId: string): Promise<StripeDisputeRecord | null>;
  findById(id: string): Promise<StripeDisputeRecord | null>;

  /**
   * Insert-or-return-existing, keyed on `stripeDisputeId`'s
   * database-level unique constraint — mirrors `PayoutRepository.
   * createPending`'s own "the database's uniqueness constraint, not
   * application code, is what guarantees only one row ever results"
   * convention (see that method's own doc comment). Two concurrent
   * `charge.dispute.created` deliveries for the same Stripe dispute must
   * both receive the SAME row back, never a second row. `created: true`
   * only when THIS call's own INSERT actually won — the caller
   * (`ProcessStripeDisputeWebhookUseCase.handleCreated`) uses this, not
   * timestamp comparison, to decide whether to publish `StripeDisputeOpened`
   * exactly once (a dispute that is never subsequently updated would
   * otherwise have equal `createdAt`/`updatedAt` forever, making that
   * comparison indistinguishable from a genuine first creation on every
   * redelivery).
   */
  createIfNotExists(data: UpsertStripeDisputeData): Promise<{ created: boolean; record: StripeDisputeRecord }>;

  /** Updates the mutable observability fields Stripe's own
   *  `charge.dispute.updated` event can change (status, amount, reason,
   *  evidence deadline) — never touches `financialAdjustmentId`/
   *  `closedAt`. A no-op (never throws) if the row is already in a
   *  terminal status (`WON`/`LOST`/`WARNING_CLOSED`) — a late/duplicate
   *  `updated` delivery after the dispute already closed must never
   *  resurrect it back to a non-terminal status. */
  updateFromStripe(
    id: string,
    data: Pick<UpsertStripeDisputeData, "amount" | "reason" | "status" | "evidenceDueBy">,
  ): Promise<StripeDisputeRecord>;

  /** Moves the row to its terminal status. Idempotent: if the row is
   *  already in the SAME terminal status this call requests, returns it
   *  unchanged (a duplicate `charge.dispute.closed` delivery — including
   *  one carrying a distinct Stripe event id — must never re-run any
   *  financial side effect a second time). */
  markClosed(input: MarkStripeDisputeClosedInput): Promise<StripeDisputeRecord>;
}
