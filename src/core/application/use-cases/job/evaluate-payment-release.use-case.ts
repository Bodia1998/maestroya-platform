import { NotFoundError } from "@/domain/errors/domain-error";
import type { JobRepository } from "@/domain/repositories/job-repository";
import type { JobCompletionConfirmationRecord, JobCompletionConfirmationRepository } from "@/domain/repositories/job-completion-confirmation-repository";
import type { DisputeRepository } from "@/domain/repositories/dispute-repository";
import type { PaymentRepository } from "@/domain/repositories/payment-repository";
import type { ProfessionalRepository } from "@/domain/repositories/professional-repository";
import type { CompanyRepository } from "@/domain/repositories/company-repository";
import type { TrustAutomatedActionRepository } from "@/domain/repositories/trust-automated-action-repository";
import { decidePaymentReleaseStatus } from "@/domain/services/payment-release-decision";
import type { EventBus } from "@/application/ports/event-bus";
import { EventDispatchError } from "@/application/ports/event-dispatch-error";
import { type FailureReporter, NullFailureReporter } from "@/application/ports/failure-reporter";
import type { CheckPayoutEligibilityUseCase } from "@/application/use-cases/verification/check-payout-eligibility.use-case";
import { PaymentReleaseApproved } from "@/domain/events/payment-release-approved";
import { PaymentReleaseHeld } from "@/domain/events/payment-release-held";
import { ConflictError } from "@/domain/errors/domain-error";

/**
 * Module 66 — Job Completion & Payment Release Protection: the ONE
 * authoritative place that evaluates and persists whether a Job's payment
 * may be released to the professional. Wraps the pure
 * `decidePaymentReleaseStatus` (`domain/services/payment-release-
 * decision.ts`) — this class's only job is to gather that function's
 * inputs from the relevant repositories/use cases and persist/publish its
 * output. No other use case in this codebase is allowed to write
 * `JobCompletionConfirmation.releaseStatus` directly.
 *
 * Called after every event that could change the release outcome:
 * customer confirmation (`ConfirmJobCompletionUseCase`), a dispute being
 * opened (`DisputeJobCompletionUseCase`) or closed (Module 21's existing
 * `CloseDisputeUseCase` — see docs/MODULE_66_...md for the follow-up
 * wiring note), a confirmation timing out
 * (`ProcessJobCompletionConfirmationsUseCase`), and on demand by an admin
 * (`AdminResolvePaymentReleaseUseCase`). Idempotent: re-running this for a
 * Job whose underlying conditions haven't changed re-persists the same
 * outcome (harmless) and does NOT re-publish an already-published
 * transition event — see the transition-detection logic below.
 *
 * ## Module 75 — Company Payout Eligibility
 * A company-owned Job's payout eligibility is evaluated via
 * `CheckPayoutEligibilityUseCase.executeForCompany` (Module 75) — the
 * company mirror of the professional KYC-eligibility check above, built
 * on Module 18's existing `CompanyVerification`/`CompanyProfile` state
 * plus a `CompanyPayoutAccount` (never a second/parallel eligibility
 * system). A Trust & Integrity `PAYOUT_HOLD` is checked against the
 * company's owner `User` (`CompanyProfile.ownerUserId`) — the same
 * `TrustAutomatedActionRepository` a professional's own hold check
 * already uses, just keyed to the owner rather than a
 * `ProfessionalProfile`. `companies` is optional so any composition root
 * that never routes company-owned Jobs through this use case is
 * unaffected; when a company-owned Job IS evaluated without `companies`
 * configured, eligibility conservatively stays `false` (`RELEASE_HELD`)
 * — the same "financial safety over completeness" default this module
 * used before Module 75, never a silent bypass.
 */
export class EvaluatePaymentReleaseUseCase {
  constructor(
    private readonly jobs: JobRepository,
    private readonly confirmations: JobCompletionConfirmationRepository,
    private readonly disputes: DisputeRepository,
    private readonly payments: PaymentRepository,
    private readonly professionals: ProfessionalRepository,
    private readonly trustAutomatedActions: TrustAutomatedActionRepository,
    private readonly payoutEligibility: CheckPayoutEligibilityUseCase,
    private readonly eventBus: EventBus,
    private readonly failureReporter: FailureReporter = new NullFailureReporter(),
    /** Module 75 — Company Payout Eligibility: optional so every existing
     *  construction of this class (before Module 75) keeps compiling
     *  unchanged. Only needed to evaluate company-owned Jobs — see this
     *  class's own doc comment. */
    private readonly companies?: CompanyRepository,
  ) {}

  async execute(jobId: string): Promise<JobCompletionConfirmationRecord> {
    const job = await this.jobs.findById(jobId);
    if (!job) {
      throw new NotFoundError("Job", jobId);
    }

    const confirmation = await this.confirmations.findByJobId(jobId);
    if (!confirmation) {
      // The professional has not completed this Job yet — there is
      // nothing to evaluate. Never reachable from this module's own call
      // sites (all of which act on an existing confirmation), guarded
      // here defensively rather than assumed.
      throw new NotFoundError("JobCompletionConfirmation", jobId);
    }

    const [disputesForJob, payments] = await Promise.all([
      this.disputes.listByJobId(jobId),
      this.payments.findByJobId(jobId),
    ]);
    const hasBlockingDispute = disputesForJob.some((d) => d.status !== "CLOSED");

    // A Job is expected to have at most one Payment in this codebase's
    // current scope (single-capture flow, pre-Stripe-Connect) — see
    // Payment's own doc comment. If that ever changes, this picks the
    // most relevant one deterministically rather than an arbitrary array
    // index: prefer one that has actually captured funds.
    const payment =
      payments.find((p) => p.status === "CAPTURED" || p.status === "PARTIALLY_REFUNDED") ?? payments[0] ?? null;

    let payoutEligible = false;
    let payoutHoldActive = false;
    if (job.professionalProfileId) {
      const [eligibility, professional] = await Promise.all([
        this.payoutEligibility.execute(job.professionalProfileId),
        this.professionals.findById(job.professionalProfileId),
      ]);
      payoutEligible = eligibility.eligible;
      if (professional) {
        const activeHolds = await this.trustAutomatedActions.listActiveForUser(professional.userId, "PAYOUT_HOLD");
        payoutHoldActive = activeHolds.length > 0;
      }
    } else if (job.companyProfileId && this.companies) {
      // Module 75 — Company Payout Eligibility: see this class's own doc
      // comment. `this.companies` being unset (a composition root that
      // never wired it) is treated the same as "not eligible" — the
      // pre-Module-75 conservative default for company-owned jobs.
      const [eligibility, company] = await Promise.all([
        this.payoutEligibility.executeForCompany(job.companyProfileId),
        this.companies.findById(job.companyProfileId),
      ]);
      payoutEligible = eligibility.eligible;
      if (company) {
        const activeHolds = await this.trustAutomatedActions.listActiveForUser(company.ownerUserId, "PAYOUT_HOLD");
        payoutHoldActive = activeHolds.length > 0;
      }
    }

    const decision = decidePaymentReleaseStatus({
      jobStatus: job.status,
      confirmationStatus: confirmation.status,
      hasBlockingDispute,
      paymentStatus: payment?.status ?? null,
      payoutEligible,
      payoutHoldActive,
    });

    const previousReleaseStatus = confirmation.releaseStatus;

    let updated: JobCompletionConfirmationRecord;
    try {
      updated = await this.confirmations.updateReleaseDecision({
        id: confirmation.id,
        releaseStatus: decision.status,
        releaseReason: decision.reason,
        releaseDecidedAt: new Date(),
        expectedReleaseStatuses: [previousReleaseStatus],
      });
    } catch (error) {
      if (error instanceof ConflictError) {
        // Lost a race with a concurrent evaluation (e.g. confirm and the
        // timeout worker firing at the same instant). No duplicate
        // financial effect results either way — the concurrent writer's
        // outcome is already the current, correct state; re-reading it
        // is safe and avoids an unbounded retry loop.
        const fresh = await this.confirmations.findById(confirmation.id);
        if (!fresh) throw new NotFoundError("JobCompletionConfirmation", confirmation.id);
        return fresh;
      }
      throw error;
    }

    // Only publish on an actual transition — re-evaluating an unchanged
    // outcome must not re-notify/re-trigger downstream subscribers a
    // second time (this is the "duplicate release evaluation does not
    // create duplicate financial effects" guarantee).
    if (decision.status !== previousReleaseStatus) {
      const events =
        decision.status === "RELEASE_APPROVED"
          ? [new PaymentReleaseApproved(jobId, confirmation.id, payment?.id ?? null)]
          : decision.status === "RELEASE_HELD"
            ? [new PaymentReleaseHeld(jobId, confirmation.id, decision.reason)]
            : []; // RELEASE_DENIED: no dedicated event — see payment-release-held.ts's doc comment.

      try {
        await this.eventBus.publishAll(events);
      } catch (error) {
        if (!(error instanceof EventDispatchError)) throw error;
        this.failureReporter.report(error, { event: error.eventName, eventId: error.eventId });
      }
    }

    return updated;
  }
}
