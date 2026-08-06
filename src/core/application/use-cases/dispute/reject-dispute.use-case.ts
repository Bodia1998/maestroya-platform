import { NotFoundError, ValidationError } from "@/domain/errors/domain-error";
import { DisputeStatusChanged } from "@/domain/events/dispute-status-changed";
import type { DisputeRecord, DisputeRepository } from "@/domain/repositories/dispute-repository";
import type { JobRepository } from "@/domain/repositories/job-repository";
import type { CustomerProfileRepository } from "@/domain/repositories/customer-profile-repository";
import type { ProfessionalRepository } from "@/domain/repositories/professional-repository";
import type { CompanyMembershipRepository } from "@/domain/repositories/company-membership-repository";
import { isRejectableStatus } from "@/domain/services/dispute-state";
import { resolveDisputeParticipantUserIds } from "@/application/use-cases/dispute/resolve-dispute-participant-user-ids";
import type { EventBus } from "@/application/ports/event-bus";
import { EventDispatchError } from "@/application/ports/event-dispatch-error";
import { type FailureReporter, NullFailureReporter } from "@/application/ports/failure-reporter";

/**
 * Module 21 — Disputes & Support: rejects a Dispute (declines to uphold it
 * — e.g. it was invalid, out of scope, or a duplicate). Distinct from
 * ResolveDisputeUseCase: a rejected dispute has no `resolution` outcome
 * (Dispute.resolution stays null) — REJECTED means "there is nothing for
 * Module 22 to act on", not "the customer/professional was favored". Sets
 * `resolutionNote` to the rejection reason for the audit trail. Admin-only.
 *
 * Module 37 — Domain Event Subscribers: see `ResolveDisputeUseCase`'s own
 * doc comment — same rationale, same `DisputeStatusChanged`
 * publish-and-report-don't-rethrow pattern, mirrored here with
 * `transition: "REJECTED"`.
 */
export class RejectDisputeUseCase {
  constructor(
    private readonly disputes: DisputeRepository,
    private readonly jobs: JobRepository,
    private readonly customerProfiles: CustomerProfileRepository,
    private readonly professionals: ProfessionalRepository,
    private readonly companyMembers: CompanyMembershipRepository,
    private readonly eventBus: EventBus,
    private readonly failureReporter: FailureReporter = new NullFailureReporter(),
  ) {}

  async execute(adminUserId: string, disputeId: string, resolutionNote: string): Promise<DisputeRecord> {
    const dispute = await this.disputes.findById(disputeId);
    if (!dispute) {
      throw new NotFoundError("Dispute", disputeId);
    }

    if (!isRejectableStatus(dispute.status)) {
      throw new ValidationError(`Cannot reject a dispute in status ${dispute.status}.`);
    }

    const updated = await this.disputes.updateStatus(disputeId, dispute.status, {
      status: "REJECTED",
      resolutionNote,
      resolvedAt: new Date(),
      resolvedByUserId: adminUserId,
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
          "REJECTED",
          adminUserId,
          "REJECTED",
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
