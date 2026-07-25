import { NotFoundError, ValidationError } from "@/domain/errors/domain-error";
import type { CommissionRecord, CommissionRepository } from "@/domain/repositories/commission-repository";
import type { FinancialLedgerRepository } from "@/domain/repositories/financial-ledger-repository";
import type { PaymentRepository } from "@/domain/repositories/payment-repository";
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
 * Idempotency: keyed deterministically off `paymentId` (never a
 * caller-supplied key — trusting the caller to generate a unique key would
 * make idempotency only as strong as the caller's own discipline). A
 * webhook redelivery, a duplicate admin retry, or a double-submit all
 * resolve to the exact same key and this use case returns the
 * already-recorded Commission unchanged rather than creating a second one.
 * The underlying `Commission.paymentId` unique constraint is a second,
 * database-level backstop against the same race.
 */
export class RecordCommissionForPaymentUseCase {
  constructor(
    private readonly payments: PaymentRepository,
    private readonly commissions: CommissionRepository,
    private readonly ledger: FinancialLedgerRepository,
    private readonly breakdowns: CalculateJobCommissionBreakdownUseCase,
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
      rateBps: breakdown.rates.professionalCommissionRateBps,
      amount: breakdown.professionalCommission,
    });

    await this.ledger.create({
      type: "LABOR_CHARGE",
      amount: breakdown.laborSubtotal,
      paymentId: payment.id,
      commissionId: commission.id,
      description: "Labor portion of captured payment (commission base).",
      idempotencyKey: `${idempotencyKey}:labor`,
    });

    if (breakdown.materialsSubtotal > 0) {
      await this.ledger.create({
        type: "MATERIALS_CHARGE",
        amount: breakdown.materialsSubtotal,
        paymentId: payment.id,
        commissionId: commission.id,
        description: "Materials portion of captured payment (never commissionable).",
        idempotencyKey: `${idempotencyKey}:materials`,
      });
    }

    await this.ledger.create({
      type: "COMMISSION",
      amount: breakdown.professionalCommission,
      paymentId: payment.id,
      commissionId: commission.id,
      // Rate is never hardcoded in the description — see
      // breakdown.rates, sourced from CommissionRateRepository.
      description: `Professional/company commission (${breakdown.rates.professionalCommissionRateBps / 100}% of labor).`,
      idempotencyKey: `${idempotencyKey}:commission`,
    });

    await this.ledger.create({
      type: "CUSTOMER_PLATFORM_FEE",
      amount: breakdown.customerPlatformFee,
      paymentId: payment.id,
      commissionId: commission.id,
      description: `Customer platform fee (${breakdown.rates.customerPlatformFeeRateBps / 100}% of labor).`,
      idempotencyKey: `${idempotencyKey}:customer-fee`,
    });

    await this.ledger.create({
      type: "PROFESSIONAL_NET_EARNING",
      amount: breakdown.professionalTotalNetEarnings,
      paymentId: payment.id,
      commissionId: commission.id,
      description: "Professional/company net earnings after commission.",
      idempotencyKey: `${idempotencyKey}:net-earning`,
    });

    await this.ledger.create({
      type: "PLATFORM_REVENUE",
      amount: breakdown.platformGrossRevenue,
      paymentId: payment.id,
      commissionId: commission.id,
      description: "MaestroYa gross revenue (customer fee + professional commission).",
      idempotencyKey,
    });

    return commission;
  }
}
