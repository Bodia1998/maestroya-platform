import { NotFoundError } from "@/domain/errors/domain-error";
import type { JobCompletionConfirmationRepository } from "@/domain/repositories/job-completion-confirmation-repository";
import type { JobRepository } from "@/domain/repositories/job-repository";
import type { PaymentRepository } from "@/domain/repositories/payment-repository";
import type { ProfessionalPayoutLedgerRepository } from "@/domain/repositories/professional-payout-ledger-repository";
import type { ProfessionalRepository } from "@/domain/repositories/professional-repository";
import type { TrustAutomatedActionRepository } from "@/domain/repositories/trust-automated-action-repository";
import type { PaymentReleaseStatus } from "@/domain/services/payment-release-decision";
import { decidePayoutReadiness, type PayoutReadinessDecision } from "@/domain/services/payout-readiness-decision";
import type { CheckPayoutEligibilityUseCase } from "@/application/use-cases/verification/check-payout-eligibility.use-case";
import type { ReconcilePaymentUseCase } from "./reconcile-payment.use-case";

/**
 * Module 69 — Financial Ledger & Payout Readiness Audit (Section 24): the
 * ONE application-level boundary that gathers every input
 * `decidePayoutReadiness` needs and returns its verdict. This is the exact
 * seam a future Module 70 (Stripe Connect) is expected to call before ever
 * initiating a real transfer — see that function's own doc comment for why
 * Module 70 can depend on this without knowing Prisma, the ledger's
 * internals, dispute internals, or Trust & Integrity's implementation.
 *
 * NEVER executes a payout. Read-only — no repository this class depends on
 * is ever called with a create/update/mark* method, matching
 * `ReconcilePaymentUseCase`'s own contract exactly (this class depends on
 * it directly rather than re-deriving reconciliation, so the two can never
 * disagree about what "financially consistent" means).
 *
 * ## Known limitation — company-owned jobs
 * Mirrors `EvaluatePaymentReleaseUseCase`'s own documented limitation
 * exactly: there is no KYC/payout-hold concept yet for a `CompanyProfile`,
 * so a company-owned Job is conservatively always `held`, never `eligible`
 * — financial safety over completeness, not silently invented behavior.
 */
export class CheckPayoutReadinessUseCase {
  constructor(
    private readonly jobs: JobRepository,
    private readonly payments: PaymentRepository,
    private readonly professionals: ProfessionalRepository,
    private readonly trustAutomatedActions: TrustAutomatedActionRepository,
    private readonly payoutEligibility: CheckPayoutEligibilityUseCase,
    private readonly payoutLedger: ProfessionalPayoutLedgerRepository,
    private readonly reconcilePayment: ReconcilePaymentUseCase,
    private readonly completionConfirmations: JobCompletionConfirmationRepository,
  ) {}

  async execute(jobId: string): Promise<PayoutReadinessDecision & { jobId: string; paymentId: string | null }> {
    const job = await this.jobs.findById(jobId);
    if (!job) {
      throw new NotFoundError("Job", jobId);
    }

    if (!job.professionalProfileId) {
      // Company-owned job — see this class's own doc comment.
      return {
        jobId,
        paymentId: null,
        status: "held",
        payableAmount: 0,
        reason: "Company-owned jobs are not yet supported by payout eligibility — see EvaluatePaymentReleaseUseCase's own documented limitation.",
      };
    }

    const payments = await this.payments.findByJobId(jobId);
    // Same deterministic "prefer a payment that actually captured funds"
    // selection as EvaluatePaymentReleaseUseCase/ResolveDisputeWithFinancialOutcomeUseCase
    // — never a second, competing definition of "the relevant Payment for
    // this job."
    const payment = payments.find((p) => p.status === "CAPTURED" || p.status === "PARTIALLY_REFUNDED") ?? payments[0] ?? null;

    if (!payment) {
      return {
        jobId,
        paymentId: null,
        status: "pending",
        payableAmount: 0,
        reason: "No payment exists for this job yet.",
      };
    }

    const [reconciliation, releaseStatus, professional, kyc, alreadyPaid] = await Promise.all([
      this.reconcilePayment.execute(payment.id),
      this.resolveReleaseStatus(jobId),
      this.professionals.findById(job.professionalProfileId),
      this.payoutEligibility.execute(job.professionalProfileId),
      this.payoutLedger.sumPaidForProfessional(job.professionalProfileId),
    ]);

    let payoutHoldActive = false;
    if (professional) {
      const activeHolds = await this.trustAutomatedActions.listActiveForUser(professional.userId, "PAYOUT_HOLD");
      payoutHoldActive = activeHolds.length > 0;
    }

    const decision = decidePayoutReadiness({
      releaseStatus,
      kycEligible: kyc.eligible,
      payoutHoldActive,
      financiallyConsistent: reconciliation.consistent,
      recognizedPayableAmount: reconciliation.amountPayableToProfessional,
      amountAlreadyPaidOut: alreadyPaid,
    });

    return { jobId, paymentId: payment.id, ...decision };
  }

  /** Same "PENDING" storage-default handling as
   *  `ReconcilePaymentUseCase.resolveReleaseStatus` — kept as a small,
   *  independent lookup here (rather than exposing it from that class)
   *  since this use case reads it for a different purpose (the
   *  `decidePayoutReadiness` gate itself, not a reconciliation issue
   *  check). Both read the exact same `JobCompletionConfirmation.releaseStatus`
   *  column, so they can never disagree about its current value. */
  private async resolveReleaseStatus(jobId: string): Promise<PaymentReleaseStatus | null> {
    const confirmation = await this.completionConfirmations.findByJobId(jobId);
    const status: string | undefined = confirmation?.releaseStatus;
    if (!confirmation || status === "PENDING") return null;
    return confirmation.releaseStatus;
  }
}
