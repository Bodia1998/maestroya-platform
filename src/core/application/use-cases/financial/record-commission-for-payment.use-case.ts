import { NotFoundError, ValidationError } from "@/domain/errors/domain-error";
import type { CommissionRecord, CommissionRepository } from "@/domain/repositories/commission-repository";
import type { FinancialLedgerRepository } from "@/domain/repositories/financial-ledger-repository";
import type { PaymentRepository } from "@/domain/repositories/payment-repository";
import type { JobCompletionConfirmationRepository } from "@/domain/repositories/job-completion-confirmation-repository";
import type { CalculateJobCommissionBreakdownUseCase } from "./calculate-job-commission-breakdown.use-case";

/**
 * Module 22 — Commission & Financial: the use case a future Module 12
 * (Payment/Stripe Connect) payment-captured webhook handler is expected to
 * call the moment a Payment transitions to CAPTURED — see the module
 * spec's "FUTURE MODULE 12 COMPATIBILITY" flow: "Payment captured ->
 * Financial transaction recorded -> Commission recognized -> Professional
 * payout eligibility." This is that step. Nothing here imports the Stripe
 * SDK or references a PaymentIntent — it only reads the already-captured
 * Payment through PaymentRepository (dependency inversion: Module 12 will
 * be the thing that eventually calls this, not the other way around).
 *
 * Commission math: entirely delegated to Module 64's
 * `CommissionCalculationService` via `CalculateJobCommissionBreakdownUseCase`
 * — this use case never computes a commission or platform-fee amount
 * itself, it only writes the already-computed breakdown to the
 * `Commission` row and the append-only `Transaction` ledger. As of
 * Module 64 there is no longer a separate `CUSTOMER_PLATFORM_FEE` ledger
 * entry — the flat commission is deducted entirely from the
 * professional's payout, never charged to the customer on top of the
 * Quote total.
 *
 * Idempotency: keyed deterministically off `paymentId` (never a
 * caller-supplied key — trusting the caller to generate a unique key would
 * make idempotency only as strong as the caller's own discipline). A
 * webhook redelivery, a duplicate admin retry, or a double-submit all
 * resolve to the exact same key and this use case returns the
 * already-recorded Commission unchanged rather than creating a second one.
 * The underlying `Commission.paymentId` unique constraint is a second,
 * database-level backstop against the same race.
 *
 * ## Module 66 gate — Payment.CAPTURED alone is NOT sufficient
 * `Payment.status === "CAPTURED"` only proves MaestroYa is holding the
 * customer's money — it says nothing about whether the professional's
 * work was ever confirmed, disputed, or is still sitting in the
 * 72-hour confirmation window. Commission recognition (and, critically,
 * the `PROFESSIONAL_NET_EARNING` ledger entry — the record of what is
 * owed to the professional) must never happen before Module 66's single
 * authoritative payment-release decision
 * (`domain/services/payment-release-decision.ts`, persisted on
 * `JobCompletionConfirmation.releaseStatus`) has reached
 * `RELEASE_APPROVED`. This use case never re-derives or duplicates that
 * decision — it only reads its already-persisted output via
 * `JobCompletionConfirmationRepository.findByJobId`, the same source of
 * truth `EvaluatePaymentReleaseUseCase`/`AdminResolvePaymentReleaseUseCase`
 * write to. See the `RELEASE_APPROVED` check below.
 */
export class RecordCommissionForPaymentUseCase {
  constructor(
    private readonly payments: PaymentRepository,
    private readonly commissions: CommissionRepository,
    private readonly ledger: FinancialLedgerRepository,
    private readonly breakdowns: CalculateJobCommissionBreakdownUseCase,
    private readonly completionConfirmations: JobCompletionConfirmationRepository,
  ) {}

  async execute(paymentId: string): Promise<CommissionRecord> {
    const payment = await this.payments.findById(paymentId);
    if (!payment) {
      throw new NotFoundError("Payment", paymentId);
    }

    if (payment.status !== "CAPTURED") {
      throw new ValidationError(
        "A commission can only be recorded once the payment has been captured.",
      );
    }

    const existing = await this.commissions.findByPaymentId(paymentId);
    if (existing) {
      return existing;
    }

    if (!payment.jobId) {
      throw new ValidationError(
        "This payment is not associated with an accepted job — cannot calculate a commission.",
      );
    }

    // Module 66 gate — see this class's own doc comment. Reads the single
    // authoritative release decision; never recomputes it. Any status
    // other than RELEASE_APPROVED (no confirmation row at all, still
    // WAITING_FOR_CUSTOMER, RELEASE_HELD for any reason — open dispute,
    // confirmation timeout under manual review, payout hold, KYC not yet
    // approved — or RELEASE_DENIED) blocks commission recognition.
    const releaseDecision = await this.completionConfirmations.findByJobId(payment.jobId);
    if (!releaseDecision || releaseDecision.releaseStatus !== "RELEASE_APPROVED") {
      throw new ValidationError(
        "This payment has not been approved for release yet — commission cannot be recognized until the Module 66 payment-release decision is RELEASE_APPROVED.",
      );
    }

    const breakdown = await this.breakdowns.execute(payment.jobId);

    const idempotencyKey = `commission:${payment.id}`;
    const alreadyLedgered = await this.ledger.findByIdempotencyKey(idempotencyKey);
    if (alreadyLedgered) {
      // A previous attempt wrote the ledger entries but the process crashed
      // before the Commission row itself was created — extremely unlikely
      // given both writes happen in quick succession, but if it ever
      // happens we still must not write the ledger entries a second time,
      // and there's no Commission to return; surface this as a validation
      // error so the caller (Module 12) knows to investigate rather than
      // silently double-recording revenue.
      throw new ValidationError(
        "A financial transaction already exists for this payment but no commission was recorded — this requires manual review.",
      );
    }

    const commission = await this.commissions.create({
      paymentId: payment.id,
      professionalProfileId: breakdown.professionalProfileId,
      companyProfileId: breakdown.companyProfileId,
      // Snapshot the rate actually used (from CommissionRateRepository at
      // calculation time), never re-derived from the resulting amounts —
      // see JobCommissionBreakdownResult.rates' own doc comment.
      rateBps: breakdown.rates.commissionRateBps,
      amount: breakdown.commission,
    });

    await this.ledger.create({
      type: "LABOR_CHARGE",
      amount: breakdown.laborSubtotal,
      paymentId: payment.id,
      commissionId: commission.id,
      description: "Labor portion of captured payment (part of the flat commission base).",
      idempotencyKey: `${idempotencyKey}:labor`,
    });

    if (breakdown.materialsSubtotal > 0) {
      await this.ledger.create({
        type: "MATERIALS_CHARGE",
        amount: breakdown.materialsSubtotal,
        paymentId: payment.id,
        commissionId: commission.id,
        description: "Materials portion of captured payment (also part of the flat commission base under Module 64).",
        idempotencyKey: `${idempotencyKey}:materials`,
      });
    }

    await this.ledger.create({
      type: "COMMISSION",
      amount: breakdown.commission,
      paymentId: payment.id,
      commissionId: commission.id,
      // Rate is never hardcoded in the description — see
      // breakdown.rates, sourced from CommissionRateRepository.
      description: `MaestroYa flat commission (${breakdown.rates.commissionRateBps / 100}% of labour + materials).`,
      idempotencyKey: `${idempotencyKey}:commission`,
    });

    await this.ledger.create({
      type: "PROFESSIONAL_NET_EARNING",
      amount: breakdown.professionalPayout,
      paymentId: payment.id,
      commissionId: commission.id,
      description: "Professional/company payout after the flat commission is deducted.",
      idempotencyKey: `${idempotencyKey}:net-earning`,
    });

    await this.ledger.create({
      type: "PLATFORM_REVENUE",
      amount: breakdown.platformGrossRevenue,
      paymentId: payment.id,
      commissionId: commission.id,
      description: "MaestroYa gross revenue (the flat commission).",
      idempotencyKey,
    });

    return commission;
  }
}
