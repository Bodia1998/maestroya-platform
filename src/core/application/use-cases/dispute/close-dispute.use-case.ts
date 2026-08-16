import { NotFoundError, ValidationError } from "@/domain/errors/domain-error";
import { DisputeStatusChanged } from "@/domain/events/dispute-status-changed";
import type { DisputeRecord, DisputeRepository } from "@/domain/repositories/dispute-repository";
import type { JobRepository } from "@/domain/repositories/job-repository";
import type { CustomerProfileRepository } from "@/domain/repositories/customer-profile-repository";
import type { ProfessionalRepository } from "@/domain/repositories/professional-repository";
import type { CompanyMembershipRepository } from "@/domain/repositories/company-membership-repository";
import type { DisputeResolutionDecisionRepository } from "@/domain/repositories/dispute-resolution-decision-repository";
import { isClosableStatus } from "@/domain/services/dispute-state";
import { disputeResolutionRequiresFinancialSettlementBeforeClose } from "@/domain/services/dispute-resolution-financial-outcome";
import { resolveDisputeParticipantUserIds } from "@/application/use-cases/dispute/resolve-dispute-participant-user-ids";
import type { EventBus } from "@/application/ports/event-bus";
import { EventDispatchError } from "@/application/ports/event-dispatch-error";
import { type FailureReporter, NullFailureReporter } from "@/application/ports/failure-reporter";

/**
 * Module 21 — Disputes & Support: closes a Dispute — only reachable from
 * RESOLVED or REJECTED (see dispute-state.ts). Admin-only, no auto-close
 * after N days in this module (explicit MVP decision — SLA automation is
 * out of scope, see docs/MODULE_21_DISPUTES_SUPPORT.md). CLOSED is
 * terminal: reopening a closed dispute is not supported (documented
 * limitation).
 *
 * ## Module 68 — Dispute Resolution & Financial Protection guard
 * `AdminResolvePaymentReleaseUseCase` (Module 66) already requires a
 * blocking Dispute to be `CLOSED` before it will approve a payout — but
 * nothing, before Module 68, stopped an admin from closing a Dispute whose
 * resolution required a refund/adjustment (`CUSTOMER_FAVOR`,
 * `PARTIAL_RESOLUTION`, `FINANCIAL_ADJUSTMENT_REQUIRED`) before that
 * adjustment was ever created and applied — which would let the Job's
 * payment release proceed to the professional despite the intended refund
 * never happening. This constructor's new `resolutionDecisions` dependency
 * closes exactly that gap: closing is blocked, with a clear
 * `ValidationError`, until an `APPLIED` `DisputeResolutionDecision` exists
 * for a Dispute whose resolution requires one — see
 * `disputeResolutionRequiresFinancialSettlementBeforeClose`'s own doc
 * comment for exactly which resolutions that covers (and the one
 * documented exception, `ESCALATED_EXTERNALLY`). `NO_ACTION` and
 * `PROFESSIONAL_FAVOR` resolutions (and `REJECTED` disputes, which have no
 * `resolution` at all) are unaffected — nothing to settle, closes exactly
 * as before Module 68. This is a guard added to the existing state
 * machine, not a second one — `isClosableStatus`/`updateStatus` are
 * unchanged.
 *
 * Module 37 — Domain Event Subscribers: see `ResolveDisputeUseCase`'s own
 * doc comment — same rationale, same `DisputeStatusChanged`
 * publish-and-report-don't-rethrow pattern, mirrored here with
 * `transition: "CLOSED"`.
 */
export class CloseDisputeUseCase {
  constructor(
    private readonly disputes: DisputeRepository,
    private readonly jobs: JobRepository,
    private readonly customerProfiles: CustomerProfileRepository,
    private readonly professionals: ProfessionalRepository,
    private readonly companyMembers: CompanyMembershipRepository,
    private readonly resolutionDecisions: DisputeResolutionDecisionRepository,
    private readonly eventBus: EventBus,
    private readonly failureReporter: FailureReporter = new NullFailureReporter(),
  ) {}

  async execute(adminUserId: string, disputeId: string): Promise<DisputeRecord> {
    const dispute = await this.disputes.findById(disputeId);
    if (!dispute) {
      throw new NotFoundError("Dispute", disputeId);
    }

    if (!isClosableStatus(dispute.status)) {
      throw new ValidationError(`Cannot close a dispute in status ${dispute.status}.`);
    }

    if (disputeResolutionRequiresFinancialSettlementBeforeClose(dispute.resolution)) {
      const decision = await this.resolutionDecisions.findByDisputeId(disputeId);
      if (!decision || decision.status !== "APPLIED") {
        throw new ValidationError(
          "This dispute's resolution requires a financial adjustment that has not been fully applied yet — resolve its financial outcome (ResolveDisputeWithFinancialOutcomeUseCase) before closing.",
        );
      }
    }

    const updated = await this.disputes.updateStatus(disputeId, dispute.status, {
      status: "CLOSED",
      closedAt: new Date(),
      closedByUserId: adminUserId,
    });

    const job = await this.jobs.findById(dispute.jobId);
    const recipientUserIds = job
      ? await resolveDisputeParticipantUserIds(job, {
          customerProfiles: this.customerProfiles,
          professionals: this.professionals,
          companyMembers: this.companyMembers,
        })
      : [];

    try {
      await this.eventBus.publishAll([
        new DisputeStatusChanged(
          disputeId,
          updated.caseNumber,
          dispute.status,
          "CLOSED",
          adminUserId,
          "CLOSED",
          recipientUserIds,
        ),
      ]);
    } catch (error) {
      if (!(error instanceof EventDispatchError)) throw error;
      this.failureReporter.report(error, { event: error.eventName, eventId: error.eventId });
    }

    return updated;
  }
}
