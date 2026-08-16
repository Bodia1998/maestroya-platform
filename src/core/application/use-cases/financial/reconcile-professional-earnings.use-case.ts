import { NotFoundError } from "@/domain/errors/domain-error";
import type { CommissionRepository } from "@/domain/repositories/commission-repository";
import type { ProfessionalPayoutLedgerRepository } from "@/domain/repositories/professional-payout-ledger-repository";
import type { ProfessionalRepository } from "@/domain/repositories/professional-repository";
import type { PaymentReconciliationReport } from "@/domain/services/financial-reconciliation";
import type { ReconcilePaymentUseCase } from "./reconcile-payment.use-case";

/**
 * Module 69 — Financial Ledger & Payout Readiness Audit (Section 14):
 * the professional-level rollup of `ReconcilePaymentUseCase` — "for a
 * professional: total captured, total commission, total earnings, total
 * refunds, total adjustments, total payable, total already paid, unresolved
 * financial inconsistencies." Read-only, never mutates anything.
 *
 * Implementation note: iterates every Commission the professional has (one
 * per captured+released Payment) and reconciles each one individually via
 * `ReconcilePaymentUseCase`, run concurrently via `Promise.all` rather than
 * serially — for a professional with an unusually large history this is
 * still O(n) reads, a known, documented scaling limit (Section 21 — "avoid
 * obvious N+1 queries," not "eliminate every possible one"); an admin-facing
 * reconciliation report is not a hot path. A materialized per-professional
 * summary table would be the Module 70+ answer if this ever becomes a real
 * bottleneck — deliberately not built preemptively here (Section 25 — don't
 * overengineer).
 */
export class ReconcileProfessionalEarningsUseCase {
  constructor(
    private readonly professionals: ProfessionalRepository,
    private readonly commissions: CommissionRepository,
    private readonly payoutLedger: ProfessionalPayoutLedgerRepository,
    private readonly reconcilePayment: ReconcilePaymentUseCase,
  ) {}

  async execute(professionalProfileId: string): Promise<{
    professionalProfileId: string;
    totalCaptured: number;
    totalCommission: number;
    totalEarnings: number;
    totalRefunded: number;
    totalPayable: number;
    totalAlreadyPaid: number;
    paymentReports: readonly PaymentReconciliationReport[];
    inconsistentPaymentIds: readonly string[];
  }> {
    const professional = await this.professionals.findById(professionalProfileId);
    if (!professional) {
      throw new NotFoundError("ProfessionalProfile", professionalProfileId);
    }

    const [commissions, totalAlreadyPaid] = await Promise.all([
      this.commissions.listForProfessional(professionalProfileId),
      this.payoutLedger.sumPaidForProfessional(professionalProfileId),
    ]);

    const paymentReports = await Promise.all(
      commissions.map((commission) => this.reconcilePayment.execute(commission.paymentId)),
    );

    // "Captured" here is the commission base (labour + materials) each
    // reconciled Payment recognized, i.e. professional net earning +
    // commission — never re-read from Payment.amount directly, since a
    // Payment can include amounts not attributable to this professional
    // (e.g. a multi-professional job is out of this codebase's current
    // scope, but this stays derived from the same authoritative ledger
    // figures the rest of this report uses either way).
    const totalCaptured = paymentReports.reduce(
      (sum, r) => sum + (r.commissionAmount !== null ? (r.professionalNetEarning ?? 0) + r.commissionAmount : 0),
      0,
    );
    const totalCommission = commissions.reduce((sum, c) => sum + c.amount, 0);
    const totalEarnings = paymentReports.reduce((sum, r) => sum + (r.professionalNetEarning ?? 0), 0);
    const totalRefunded = paymentReports.reduce((sum, r) => sum + r.totalRefunded, 0);
    const totalPayable = paymentReports.reduce((sum, r) => sum + (r.amountPayableToProfessional ?? 0), 0);
    const inconsistentPaymentIds = paymentReports.filter((r) => !r.consistent).map((r) => r.paymentId);

    return {
      professionalProfileId,
      totalCaptured,
      totalCommission,
      totalEarnings,
      totalRefunded,
      totalPayable: Math.max(0, totalPayable - totalAlreadyPaid),
      totalAlreadyPaid,
      paymentReports,
      inconsistentPaymentIds,
    };
  }
}
