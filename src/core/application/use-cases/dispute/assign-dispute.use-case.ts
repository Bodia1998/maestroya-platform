import { NotFoundError } from "@/domain/errors/domain-error";
import { DisputeAssigned } from "@/domain/events/dispute-assigned";
import type { DisputeRecord, DisputeRepository } from "@/domain/repositories/dispute-repository";
import type { EventBus } from "@/application/ports/event-bus";
import { EventDispatchError } from "@/application/ports/event-dispatch-error";
import { type FailureReporter, NullFailureReporter } from "@/application/ports/failure-reporter";

/**
 * Module 21 — Disputes & Support: assigns (or unassigns, when
 * `adminUserId` is null) a Dispute to an admin/support agent. Admin-only —
 * trusts the caller has already been authorized via
 * `requireRole(ADMIN, SUPER_ADMIN, SUPPORT)` at the Server Action boundary.
 *
 * Module 37 — Domain Event Subscribers: this use case no longer writes the
 * audit log entry or notifies the new assignee itself — both happen
 * because `DisputeAssigned` is published through the Module 34 `EventBus`,
 * reacted to by `RecordDisputeAssignedAuditLogSubscriber`/
 * `NotifyDisputeAssignedSubscriber`. See `ResolveDisputeUseCase`'s own doc
 * comment for the identical publish-and-report-don't-rethrow rationale.
 */
export class AssignDisputeUseCase {
  constructor(
    private readonly disputes: DisputeRepository,
    private readonly eventBus: EventBus,
    private readonly failureReporter: FailureReporter = new NullFailureReporter(),
  ) {}

  async execute(adminUserId: string, disputeId: string, assigneeUserId: string | null): Promise<DisputeRecord> {
    const existing = await this.disputes.findById(disputeId);
    if (!existing) {
      throw new NotFoundError("Dispute", disputeId);
    }

    const updated = await this.disputes.assign(disputeId, assigneeUserId);

    try {
      await this.eventBus.publishAll([
        new DisputeAssigned(disputeId, updated.caseNumber, existing.assignedAdminUserId, assigneeUserId, adminUserId),
      ]);
    } catch (error) {
      if (!(error instanceof EventDispatchError)) throw error;
      this.failureReporter.report(error, { event: error.eventName, eventId: error.eventId });
    }

    return updated;
  }
}
