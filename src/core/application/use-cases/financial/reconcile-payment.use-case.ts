import { NotFoundError } from "@/domain/errors/domain-error";
import type { CommissionRepository } from "@/domain/repositories/commission-repository";
import { REFUND_TYPE_ADJUSTMENTS, type FinancialAdjustmentRepository } from "@/domain/repositories/financial-adjustment-repository";
import type { FinancialLedgerRepository } from "@/domain/repositories/financial-ledger-repository";
import type { JobCompletionConfirmationRepository } from "@/domain/repositories/job-completion-confirmation-repository";
import type { PaymentRepository } from "@/domain/repositories/payment-repository";
import { reconcilePayment, type PaymentReconciliationReport } from "@/domain/services/financial-reconciliation";

/**
 * Module 69 — Financial Ledger & Payout Readiness Audit (Section 14):
 * the read-only application boundary that answers, for one Payment, "what
 * Commission exists? What ledger entries exist? What refunds exist? Is the
 * financial chain internally consistent?" — gathering every input the pure
 * `reconcilePayment` domain function needs and returning its verdict
 * unchanged. NEVER writes anything — no repository this class depends on is
 * ever called with a create/update/mark* method. Also the one dependency
 * `CheckPayoutReadinessUseCase` reuses for its `financiallyConsistent`/
 * `recognizedPayableAmount` inputs, so the two use cases can never
 * disagree about what "consistent" means (a single source of truth, per
 * Section 25 — reuse, don't duplicate).
 *
 * Authorization: admin-only in practice (surfaced through an admin
 * reconciliation/audit Server Action) — this class itself does not check a
 * role, following the same convention as `GetPlatformRevenueSummaryUseCase`
 * and every other admin-only read use case in this codebase; the caller is
 * responsible for `requireRole(ROLES.ADMIN, ROLES.SUPER_ADMIN)`.
 */
export class ReconcilePaymentUseCase {
  constructor(
    private readonly payments: PaymentRepository,
    private readonly commissions: CommissionRepository,
    private readonly ledger: FinancialLedgerRepository,
    private readonly adjustments: FinancialAdjustmentRepository,
    private readonly completionConfirmations: JobCompletionConfirmationRepository,
  ) {}

  async execute(paymentId: string): Promise<PaymentReconciliationReport> {
    const payment = await this.payments.findById(paymentId);
    if (!payment) {
      throw new NotFoundError("Payment", paymentId);
    }

    const [commission, ledgerEntries, appliedRefundAdjustmentsTotal, releaseStatus] = await Promise.all([
      this.commissions.findByPaymentId(paymentId),
      this.ledger.listForPayment(paymentId),
      this.adjustments.sumAppliedAmountForPayment(paymentId, REFUND_TYPE_ADJUSTMENTS),
      this.resolveReleaseStatus(payment.jobId),
    ]);

    return reconcilePayment({
      payment: { id: payment.id, amount: payment.amount, currency: payment.currency, status: payment.status },
      commission,
      ledgerEntries,
      appliedRefundAdjustmentsTotal,
      releaseStatus,
    });
  }

  private async resolveReleaseStatus(jobId: string | null) {
    if (!jobId) return null;
    const confirmation = await this.completionConfirmations.findByJobId(jobId);
    // "PENDING" is a storage default the pure decision function's release
    // vocabulary never itself produces — `PrismaJobCompletionConfirmationRepository`
    // widens it onto the narrower `PaymentReleaseStatus` type with its own
    // `as PaymentReleaseStatus` cast (see that file), so it can still appear
    // here at runtime. Treated as "not yet evaluated" (null) for
    // reconciliation purposes, same as no confirmation existing at all.
    const status: string | undefined = confirmation?.releaseStatus;
    if (!confirmation || status === "PENDING") return null;
    return confirmation.releaseStatus;
  }
}
