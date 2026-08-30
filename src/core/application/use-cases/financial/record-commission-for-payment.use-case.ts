import { NotFoundError, ValidationError } from "@/domain/errors/domain-error";
import type { CommissionRecord, CommissionRepository } from "@/domain/repositories/commission-repository";
import type { CreateLedgerEntryData, FinancialLedgerRepository } from "@/domain/repositories/financial-ledger-repository";
import type { PaymentRepository } from "@/domain/repositories/payment-repository";
import type { JobCompletionConfirmationRepository } from "@/domain/repositories/job-completion-confirmation-repository";
import { roundToCents } from "@/domain/services/money";
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
 * ## Module 84 hardening — idempotent on BOTH the Commission row and every
 * ledger entry, independently
 * `execute()` is safe to call any number of times for the same
 * `paymentId`, including after a crash that left the financial record
 * only partially written. Two things changed from the original Module 22
 * implementation to make that true:
 *
 *   1. **Commission creation** is wrapped so a concurrent duplicate call
 *      (two webhook redeliveries racing, a subscriber retry racing an
 *      admin retry) that loses the `Commission.paymentId` unique-
 *      constraint race converges on the winning row instead of throwing —
 *      see the `catch` around `commissions.create` below.
 *   2. **Ledger completeness is re-verified on every call**, not only the
 *      first one that creates the Commission. The original implementation
 *      returned the already-recorded Commission immediately on a repeat
 *      call ("if (existing) return existing") without ever re-checking
 *      whether all five ledger entries had actually been written — if an
 *      earlier attempt crashed after `commissions.create` succeeded but
 *      before all five `ledger.create` calls completed, that partial
 *      ledger write was silently permanent: no future call would ever
 *      revisit it, and `FinancialLedgerRepository.listForPayment` would
 *      return an inconsistent, incomplete history forever. `ensureLedgerEntries`
 *      below fixes this: every entry is looked up by its deterministic
 *      idempotency key and only created if missing, on every call,
 *      whether or not the Commission itself was just created.
 *
 * Every persisted amount is always derived from the Commission's own
 * already-recorded, frozen `amount`/`rateBps` — never from a fresh
 * `CalculateJobCommissionBreakdownUseCase` result's `commission`/
 * `professionalPayout` fields on a repeat call, since those are computed
 * from the platform's *current* commission rate and would silently drift
 * from what this Commission actually charged if the rate changed in the
 * meantime. Only `laborSubtotal`/`materialsSubtotal` are ever taken from a
 * repeat breakdown call, because those are re-summed from the accepted
 * Quote's immutable QuoteItem amounts and are not a function of the
 * commission rate at all.
 *
 * ## Module 66 gate is expected, not a failure
 * `RecordCommissionForPaymentUseCase` itself refuses to record a
 * commission until Module 66's payment-release decision reaches
 * `RELEASE_APPROVED` (job completion confirmed) — see that use case's own
 * doc comment. At the moment a payment is first captured, that decision
 * almost never exists yet (the job has usually not even started). This is
 * only re-checked the first time a Commission is created for a given
 * `paymentId` — once recorded, the Commission is immutable and this gate
 * is never re-evaluated (see the doc comment above).
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

    let commission = await this.commissions.findByPaymentId(paymentId);

    if (!commission) {
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
      // approved — or RELEASE_DENIED) blocks commission recognition. Only
      // evaluated for a Commission that does not exist yet — once
      // recorded, a Commission is immutable and this gate is never
      // re-litigated on a later call.
      const releaseDecision = await this.completionConfirmations.findByJobId(payment.jobId);
      if (!releaseDecision || releaseDecision.releaseStatus !== "RELEASE_APPROVED") {
        throw new ValidationError(
          "This payment has not been approved for release yet — commission cannot be recognized until the Module 66 payment-release decision is RELEASE_APPROVED.",
        );
      }
    }

    // Re-summed from the accepted Quote's immutable QuoteItem amounts on
    // every call — never a function of the commission rate, so this is
    // always safe to recompute, including on a call that finds an
    // already-recorded Commission (needed for the ledger-completeness
    // backfill below).
    const breakdown = payment.jobId ? await this.breakdowns.execute(payment.jobId) : null;

    if (!commission) {
      if (!breakdown) {
        // Unreachable in practice — payment.jobId was required above
        // whenever commission is null — but keeps this branch total.
        throw new ValidationError(
          "This payment is not associated with an accepted job — cannot calculate a commission.",
        );
      }
      try {
        commission = await this.commissions.create({
          paymentId: payment.id,
          professionalProfileId: breakdown.professionalProfileId,
          companyProfileId: breakdown.companyProfileId,
          // Snapshot the rate actually used (from CommissionRateRepository at
          // calculation time), never re-derived from the resulting amounts —
          // see JobCommissionBreakdownResult.rates' own doc comment.
          rateBps: breakdown.rates.commissionRateBps,
          amount: breakdown.commission,
        });
      } catch (error) {
        // Lost a race with a concurrent call that created the Commission
        // first — Commission.paymentId's DB-level unique constraint is the
        // authoritative backstop (see PrismaCommissionRepository.create's
        // own doc comment). Converge on the winning row instead of
        // failing; if it genuinely isn't there, this was some other
        // failure and must still propagate.
        const raced = await this.commissions.findByPaymentId(paymentId);
        if (!raced) {
          throw error;
        }
        commission = raced;
      }
    }

    if (breakdown) {
      await this.ensureLedgerEntries(payment.id, commission, breakdown.laborSubtotal, breakdown.materialsSubtotal);
    }

    return commission;
  }

  /**
   * Idempotently ensures all five ledger entries for this Commission
   * exist. Safe to call on every `execute()` invocation — each entry is
   * looked up by its deterministic idempotency key first, and only
   * created if genuinely missing. `professionalPayout` here is always
   * `laborSubtotal + materialsSubtotal - commission.amount`, using the
   * Commission's own frozen, already-persisted `amount` — never a
   * freshly recalculated figure — so a platform-wide rate change between
   * the original recording and a later backfill can never change what
   * gets ledgered.
   */
  private async ensureLedgerEntries(
    paymentId: string,
    commission: CommissionRecord,
    laborSubtotal: number,
    materialsSubtotal: number,
  ): Promise<void> {
    const idempotencyKey = `commission:${paymentId}`;
    const professionalPayout = roundToCents(laborSubtotal + materialsSubtotal - commission.amount);

    await this.ensureLedgerEntry({
      type: "LABOR_CHARGE",
      amount: laborSubtotal,
      paymentId,
      commissionId: commission.id,
      description: "Labor portion of captured payment (part of the flat commission base).",
      idempotencyKey: `${idempotencyKey}:labor`,
    });

    if (materialsSubtotal > 0) {
      await this.ensureLedgerEntry({
        type: "MATERIALS_CHARGE",
        amount: materialsSubtotal,
        paymentId,
        commissionId: commission.id,
        description: "Materials portion of captured payment (also part of the flat commission base under Module 64).",
        idempotencyKey: `${idempotencyKey}:materials`,
      });
    }

    await this.ensureLedgerEntry({
      type: "COMMISSION",
      amount: commission.amount,
      paymentId,
      commissionId: commission.id,
      // Rate is never hardcoded in the description — sourced from the
      // Commission's own frozen rateBps, never a live rate lookup.
      description: `MaestroYa flat commission (${commission.rateBps / 100}% of labour + materials).`,
      idempotencyKey: `${idempotencyKey}:commission`,
    });

    await this.ensureLedgerEntry({
      type: "PROFESSIONAL_NET_EARNING",
      amount: professionalPayout,
      paymentId,
      commissionId: commission.id,
      description: "Professional/company payout after the flat commission is deducted.",
      idempotencyKey: `${idempotencyKey}:net-earning`,
    });

    await this.ensureLedgerEntry({
      type: "PLATFORM_REVENUE",
      amount: commission.amount,
      paymentId,
      commissionId: commission.id,
      description: "MaestroYa gross revenue (the flat commission).",
      idempotencyKey,
    });
  }

  /** Creates one ledger entry unless it already exists (by idempotency
   *  key), and tolerates losing a concurrent-create race the same way
   *  Commission creation does above — see this class's own doc comment. */
  private async ensureLedgerEntry(data: CreateLedgerEntryData): Promise<void> {
    const existing = await this.ledger.findByIdempotencyKey(data.idempotencyKey);
    if (existing) {
      return;
    }
    try {
      await this.ledger.create(data);
    } catch (error) {
      const raced = await this.ledger.findByIdempotencyKey(data.idempotencyKey);
      if (!raced) {
        throw error;
      }
    }
  }
}
