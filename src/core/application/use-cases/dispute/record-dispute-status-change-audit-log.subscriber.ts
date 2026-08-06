import type { AdminAuditAction, AdminAuditLogRepository } from "@/domain/repositories/admin-audit-log-repository";
import type { DisputeStatusChanged } from "@/domain/events/dispute-status-changed";
import type { EventHandler } from "@/application/ports/event-bus";

const ACTION_FOR_TRANSITION: Record<DisputeStatusChanged["transition"], AdminAuditAction> = {
  RESOLVED: "DISPUTE_RESOLVED",
  REJECTED: "DISPUTE_REJECTED",
  CLOSED: "DISPUTE_CLOSED",
  STATUS_CHANGED: "DISPUTE_STATUS_CHANGED",
};

/**
 * Module 37 — Domain Event Subscribers (Notifications & Audit Log).
 *
 * The `AuditLogSubscriber` for `DisputeStatusChanged`
 * (`domain/events/dispute-status-changed.ts`) — mirrors
 * `RecordProfessionalVerificationAuditLogSubscriber` exactly. Reacts to the
 * event by writing exactly the same `AdminAuditLogRepository.record` call
 * `ResolveDisputeUseCase`/`RejectDisputeUseCase`/`CloseDisputeUseCase`/
 * `ChangeDisputeStatusUseCase` used to make directly — no business logic
 * here, just translating the event's fields into `RecordAdminAuditLogData`
 * and delegating to the existing repository.
 *
 * `metadata` reproduces each use case's own pre-Module-37 metadata byte for
 * byte: `{ resolution }` for RESOLVED, `{}` for REJECTED/CLOSED, `{ from,
 * to }` for STATUS_CHANGED.
 *
 * Registered against the shared `eventBus`
 * (`infrastructure/events/compose.ts`) from `dispute/compose.ts`, following
 * the exact registration pattern `verification/compose.ts` documents.
 *
 * A thrown error here is caught by `SynchronousEventBus.publish` and
 * surfaces to the publishing use case as part of an `EventDispatchError` —
 * it never corrupts the dispute's already-persisted status change.
 */
export class RecordDisputeStatusChangeAuditLogSubscriber implements EventHandler<DisputeStatusChanged> {
  constructor(private readonly auditLog: AdminAuditLogRepository) {}

  async handle(event: DisputeStatusChanged): Promise<void> {
    const metadata =
      event.transition === "RESOLVED"
        ? { resolution: event.resolution }
        : event.transition === "STATUS_CHANGED"
          ? { from: event.previousStatus, to: event.newStatus }
          : {};

    await this.auditLog.record({
      adminUserId: event.actorUserId,
      action: ACTION_FOR_TRANSITION[event.transition],
      targetType: "Dispute",
      targetId: event.disputeId,
      metadata,
    });
  }
}
