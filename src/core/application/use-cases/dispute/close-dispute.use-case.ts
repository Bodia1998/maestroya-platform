import { NotFoundError, ValidationError } from "@/domain/errors/domain-error";
import { DisputeStatusChanged } from "@/domain/events/dispute-status-changed";
import type { DisputeRecord, DisputeRepository } from "@/domain/repositories/dispute-repository";
import type { JobRepository } from "@/domain/repositories/job-repository";
import type { CustomerProfileRepository } from "@/domain/repositories/customer-profile-repository";
import type { ProfessionalRepository } from "@/domain/repositories/professional-repository";
import type { CompanyMembershipRepository } from "@/domain/repositories/company-membership-repository";
import { isClosableStatus } from "@/domain/services/dispute-state";
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
