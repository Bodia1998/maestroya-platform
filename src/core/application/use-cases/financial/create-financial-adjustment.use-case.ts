import { NotFoundError, ValidationError } from "@/domain/errors/domain-error";
import {
  REFUND_TYPE_ADJUSTMENTS,
  type FinancialAdjustmentRecord,
  type FinancialAdjustmentRepository,
  type FinancialAdjustmentTypeValue,
} from "@/domain/repositories/financial-adjustment-repository";
import type { FinancialLedgerRepository } from "@/domain/repositories/financial-ledger-repository";
import type { JobRepository } from "@/domain/repositories/job-repository";
import type { PaymentRepository } from "@/domain/repositories/payment-repository";

/**
 * Module 22 — Commission & Financial: the boundary Module 21 (Disputes &
 * Support) is expected to trigger a financial consequence of a resolved
 * Dispute through. This use case is called from the admin/support delivery
 * layer (e.g. an admin action invoked right after `resolveDisputeAction`,
 * see docs/MODULE_22_COMMISSION_FINANCIAL.md, "Module 21 integration") —
 * never from inside Module 21's own `ResolveDisputeUseCase`, which is
 * documented to never move money itself. Module 21's own files are not
 * modified by this module.
 *
 * Deliberately does not import DisputeRepository or any Dispute domain
 * type — `disputeId` is accepted and stored purely as an opaque
 * traceability reference (FinancialAdjustment.disputeId), keeping this
 * module decoupled from Module 21's own domain model, matching the spec's
 * "do not couple the dispute module to Stripe implementation details" (and
 * the converse: don't couple this module to dispute internals either).
 *
 * Authorization: enforced by the caller (`requireRole(ROLES.ADMIN,
 * ROLES.SUPER_ADMIN, ROLES.SUPPORT)`), same convention as every other
 * admin/support use case in this codebase — see resolve-dispute.use-case's
 * own admin-side actions. `requestedByUserId` is always the acting
 * admin/support user's own session id, passed in by the Server Action,
 * never client-supplied.
 *
 * Idempotency: the key is deterministic — `adjustment:<jobId>:<disputeId
 * or "none">:<type>:<paymentId or "none">` — so retrying the exact same
 * logical adjustment (a double-submit admin click, a retried background
 * job) can never create a duplicate. This does mean the same
 * (job, dispute, type, payment) tuple can only ever produce one
 * adjustment; a genuinely distinct second adjustment of the same type
 * against the same dispute is not supported by this module and would need
 * a product decision (e.g. an explicit sequence number) if ever required.
 *
 * ## Module 69 — Refund boundedness (Invariant 8)
 * The idempotency key above only prevents the *same* (job, dispute, type,
 * payment) tuple from double-applying — it does NOT stop two genuinely
 * distinct adjustments (e.g. two different Disputes resolved sequentially
 * against the same Job/Payment, each with a `PARTIAL_REFUND`) from
 * cumulatively refunding more than was ever captured. Before creating a
 * `REFUND_TYPE_ADJUSTMENTS` adjustment (`FULL_REFUND`/`PARTIAL_REFUND`/
 * `PLATFORM_FEE_REFUND`) against a Payment, this use case now sums every
 * already-`APPLIED` refund-type adjustment for that same Payment
 * (`FinancialAdjustmentRepository.sumAppliedAmountForPayment`) and rejects
 * with `ValidationError` if `alreadyRefunded + this.amount` would exceed
 * `Payment.amount`. This is an early, friendly rejection for the normal
 * case; the authoritative, race-safe backstop is the Postgres trigger added
 * by migration `20260825000000_add_refund_boundedness_guard` (see that
 * migration's own comment) — per this module's "database-level guarantees
 * are preferred" safety rule, this application check is never the ONLY
 * protection.
 */
export class CreateFinancialAdjustmentUseCase {
  constructor(
    private readonly jobs: JobRepository,
    private readonly adjustments: FinancialAdjustmentRepository,
    private readonly ledger: FinancialLedgerRepository,
    private readonly payments: PaymentRepository,
  ) {}

  async execute(
    requestedByUserId: string,
    input: {
      jobId: string;
      disputeId: string | null;
      paymentId: string | null;
      type: FinancialAdjustmentTypeValue;
      amount: number;
      reason: string | null;
      /** Module 68 — Dispute Resolution & Financial Protection: threaded
       *  through unchanged to `FinancialAdjustmentRepository.create` — see
       *  that interface's own doc comment. Optional so every pre-existing
       *  caller of this use case is unaffected. */
      resolutionDecisionId?: string | null;
    },
  ): Promise<FinancialAdjustmentRecord> {
    const job = await this.jobs.findById(input.jobId);
    if (!job) {
      throw new NotFoundError("Job", input.jobId);
    }

    const idempotencyKey = [
      "adjustment",
      input.jobId,
      input.disputeId ?? "none",
      input.type,
      input.paymentId ?? "none",
    ].join(":");

    const existing = await this.adjustments.findByIdempotencyKey(idempotencyKey);
    if (existing) {
      return existing;
    }

    // Module 69 — Invariant 8 (refund boundedness): see this class's own
    // doc comment. Only refund-type adjustments that return captured
    // customer funds are bounded this way, and only when a Payment is
    // actually referenced (a pre-Payment dispute has nothing to bound
    // against).
    if (REFUND_TYPE_ADJUSTMENTS.includes(input.type) && input.paymentId) {
      const payment = await this.payments.findById(input.paymentId);
      if (!payment) {
        throw new NotFoundError("Payment", input.paymentId);
      }
      const alreadyRefunded = await this.adjustments.sumAppliedAmountForPayment(
        input.paymentId,
        REFUND_TYPE_ADJUSTMENTS,
      );
      if (alreadyRefunded + input.amount > payment.amount) {
        throw new ValidationError(
          `This adjustment (${input.amount}) combined with already-applied refunds for this payment (${alreadyRefunded}) would exceed the captured amount (${payment.amount}) — refunds can never exceed what was captured.`,
        );
      }
    }

    const created = await this.adjustments.create({
      jobId: input.jobId,
      disputeId: input.disputeId,
      paymentId: input.paymentId,
      type: input.type,
      amount: input.amount,
      reason: input.reason,
      requestedByUserId,
      idempotencyKey,
      resolutionDecisionId: input.resolutionDecisionId ?? null,
    });

    try {
      const transaction = await this.ledger.create({
        type: input.type === "COMMISSION_REVERSAL" ? "COMMISSION_REVERSAL" : "DISPUTE_ADJUSTMENT",
        // Signed: every adjustment type here reduces what the platform or
        // professional ultimately retains, EXCEPT releasing a payout that
        // was being held pending investigation — that's a neutral/positive
        // event (money that was already earned is simply no longer held
        // back), not a new outflow.
        amount: input.type === "PROFESSIONAL_PAYOUT_RELEASE" ? input.amount : -input.amount,
        paymentId: input.paymentId ?? undefined,
        description: input.reason ?? `Financial adjustment: ${input.type}`,
        idempotencyKey: `${idempotencyKey}:ledger`,
      });

      return await this.adjustments.markApplied(created.id, transaction.id);
    } catch (error) {
      await this.adjustments.markFailed(created.id);
      throw error;
    }
  }
}
