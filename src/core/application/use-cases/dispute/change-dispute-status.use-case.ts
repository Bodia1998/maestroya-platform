import { NotFoundError, ValidationError } from "@/domain/errors/domain-error";
import { DisputeStatusChanged } from "@/domain/events/dispute-status-changed";
import type { DisputeRecord, DisputeRepository, DisputeStatusValue } from "@/domain/repositories/dispute-repository";
import type { JobRepository } from "@/domain/repositories/job-repository";
import type { CustomerProfileRepository } from "@/domain/repositories/customer-profile-repository";
import type { ProfessionalRepository } from "@/domain/repositories/professional-repository";
import type { CompanyMembershipRepository } from "@/domain/repositories/company-membership-repository";
import { canTransitionDisputeStatus } from "@/domain/services/dispute-state";
import { resolveDisputeParticipantUserIds } from "@/application/use-cases/dispute/resolve-dispute-participant-user-ids";
import type { EventBus } from "@/application/ports/event-bus";
import { EventDispatchError } from "@/application/ports/event-dispatch-error";
import { type FailureReporter, NullFailureReporter } from "@/application/ports/failure-reporter";

/**
 * Module 21 — Disputes & Support: admin-only generic status transition —
 * covers OPEN -> UNDER_REVIEW and UNDER_REVIEW <-> WAITING_FOR_CUSTOMER/
 * WAITING_FOR_PROFESSIONAL (the "request info from a party" workflow step).
 * RESOLVED/REJECTED/CLOSED each have their own dedicated use case
 * (ResolveDisputeUseCase/RejectDisputeUseCase/CloseDisputeUseCase) since
 * those three require additional fields (resolution/resolutionNote) this
 * generic transition does not collect — this use case explicitly refuses
 * to write RESOLVED/REJECTED/CLOSED itself (see the guard below) so there
 * is exactly one code path that ever sets Dispute.resolution.
 *
 * Every transition (including admin-initiated ones — the module spec's
 * "can admins override normal transitions" answer) still goes through
 * `canTransitionDisputeStatus`, never a raw field write. Trusts the caller
 * has already been authorized via `requireRole(ADMIN, SUPER_ADMIN,
 * SUPPORT)` at the Server Action boundary.
 *
 * Module 37 — Domain Event Subscribers: see `ResolveDisputeUseCase`'s own
 * doc comment — same rationale, same `DisputeStatusChanged`
 * publish-and-report-don't-rethrow pattern, mirrored here with
 * `transition: "STATUS_CHANGED"` — the notification subscriber further
 * distinguishes a "response requested" notification from a plain
 * "status updated" one using `newStatus` itself (see that event's own doc
 * comment), the same way this use case's own pre-Module-37
 * `isResponseRequest` check did.
 */
export class ChangeDisputeStatusUseCase {
  constructor(
    private readonly disputes: DisputeRepository,
    private readonly jobs: JobRepository,
    private readonly customerProfiles: CustomerProfileRepository,
    private readonly professionals: ProfessionalRepository,
    private readonly companyMembers: CompanyMembershipRepository,
    private readonly eventBus: EventBus,
    private readonly failureReporter: FailureReporter = new NullFailureReporter(),
  ) {}

  async execute(adminUserId: string, disputeId: string, nextStatus: DisputeStatusValue): Promise<DisputeRecord> {
    if (nextStatus === "RESOLVED" || nextStatus === "REJECTED" || nextStatus === "CLOSED") {
      throw new ValidationError(
        "Use the resolve/reject/close action for this transition — it requires a resolution note.",
      );
    }

    const dispute = await this.disputes.findById(disputeId);
    if (!dispute) {
      throw new NotFoundError("Dispute", disputeId);
    }

    if (!canTransitionDisputeStatus(dispute.status, nextStatus)) {
      throw new ValidationError(`Cannot move a dispute from ${dispute.status} to ${nextStatus}.`);
    }

    const updated = await this.disputes.updateStatus(disputeId, dispute.status, { status: nextStatus });

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
          nextStatus,
          adminUserId,
          "STATUS_CHANGED",
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
