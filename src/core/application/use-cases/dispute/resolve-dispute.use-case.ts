import { NotFoundError, ValidationError } from "@/domain/errors/domain-error";
import { DisputeStatusChanged } from "@/domain/events/dispute-status-changed";
import type {
  DisputeRecord,
  DisputeRepository,
  DisputeResolutionValue,
} from "@/domain/repositories/dispute-repository";
import type { JobRepository } from "@/domain/repositories/job-repository";
import type { CustomerProfileRepository } from "@/domain/repositories/customer-profile-repository";
import type { ProfessionalRepository } from "@/domain/repositories/professional-repository";
import type { CompanyMembershipRepository } from "@/domain/repositories/company-membership-repository";
import { isResolvableStatus } from "@/domain/services/dispute-state";
import { resolveDisputeParticipantUserIds } from "@/application/use-cases/dispute/resolve-dispute-participant-user-ids";
import type { EventBus } from "@/application/ports/event-bus";
import { EventDispatchError } from "@/application/ports/event-dispatch-error";
import { type FailureReporter, NullFailureReporter } from "@/application/ports/failure-reporter";

export interface ResolveDisputeInput {
  resolution: DisputeResolutionValue;
  resolutionNote: string;
}

/**
 * Module 21 — Disputes & Support: resolves a Dispute — the one place
 * `Dispute.resolution` is ever set. Records a *business-level* outcome only
 * (see DisputeResolutionValue's doc comment on schema.prisma) — this use
 * case never touches Stripe, never calculates a refund/commission amount,
 * never moves money. A future Module 22 is expected to read
 * `resolution`/`resolutionNote` off a RESOLVED dispute and execute the
 * actual financial settlement, entirely outside this module.
 *
 * Admin-only — trusts the caller has already been authorized via
 * `requireRole(ADMIN, SUPER_ADMIN, SUPPORT)` at the Server Action boundary.
 * Does NOT close the case — RESOLVED and CLOSED are deliberately distinct
 * (see dispute-state.ts's own doc comment); a separate admin action
 * (CloseDisputeUseCase) closes it.
 *
 * Module 37 — Domain Event Subscribers: this use case no longer writes the
 * audit log entry or notifies the dispute's participants itself — both
 * happen because `DisputeStatusChanged` is published through the Module 34
 * `EventBus`, reacted to by `RecordDisputeStatusChangeAuditLogSubscriber`/
 * `NotifyDisputeStatusChangeSubscriber`. See
 * `SubmitProfessionalVerificationUseCase`'s own doc comment for the
 * identical publish-and-report-don't-rethrow rationale, mirrored here
 * exactly.
 */
export class ResolveDisputeUseCase {
  constructor(
    private readonly disputes: DisputeRepository,
    private readonly jobs: JobRepository,
    private readonly customerProfiles: CustomerProfileRepository,
    private readonly professionals: ProfessionalRepository,
    private readonly companyMembers: CompanyMembershipRepository,
    private readonly eventBus: EventBus,
    private readonly failureReporter: FailureReporter = new NullFailureReporter(),
  ) {}

  async execute(adminUserId: string, disputeId: string, input: ResolveDisputeInput): Promise<DisputeRecord> {
    const dispute = await this.disputes.findById(disputeId);
    if (!dispute) {
      throw new NotFoundError("Dispute", disputeId);
    }

    if (!isResolvableStatus(dispute.status)) {
      throw new ValidationError(`Cannot resolve a dispute in status ${dispute.status}.`);
    }

    const updated = await this.disputes.updateStatus(disputeId, dispute.status, {
      status: "RESOLVED",
      resolution: input.resolution,
      resolutionNote: input.resolutionNote,
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
          "RESOLVED",
          adminUserId,
          "RESOLVED",
          recipientUserIds,
          input.resolution,
        ),
      ]);
    } catch (error) {
      if (!(error instanceof EventDispatchError)) throw error;
      this.failureReporter.report(error, { event: error.eventName, eventId: error.eventId });
    }

    return updated;
  }
}
