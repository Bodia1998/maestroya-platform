import type { AdminAuditAction, AdminAuditLogRepository } from "@/domain/repositories/admin-audit-log-repository";
import type { ProfessionalVerificationStatusChanged } from "@/domain/events/professional-verification-status-changed";
import type { EventHandler } from "@/application/ports/event-bus";

const ACTION_FOR_TRANSITION: Record<ProfessionalVerificationStatusChanged["transition"], AdminAuditAction> = {
  SUBMITTED: "VERIFICATION_SUBMITTED",
  RESUBMITTED: "VERIFICATION_RESUBMITTED",
  APPROVED: "VERIFICATION_APPROVED",
  REJECTED: "VERIFICATION_REJECTED",
  RESUBMISSION_REQUESTED: "VERIFICATION_RESUBMISSION_REQUESTED",
};

/**
 * Module 37 — Domain Event Subscribers (Notifications & Audit Log).
 *
 * The `AuditLogSubscriber` for `ProfessionalVerificationStatusChanged`
 * (`domain/events/professional-verification-status-changed.ts`) — mirrors
 * `RecordCompanyStatusChangeAuditLogSubscriber` exactly. Reacts to the
 * event by writing exactly the same `AdminAuditLogRepository.record` call
 * `SubmitProfessionalVerificationUseCase`/`ResubmitProfessionalVerificationUseCase`/
 * `ApproveProfessionalVerificationUseCase`/`RejectProfessionalVerificationUseCase`/
 * `RequestVerificationResubmissionUseCase` used to make directly — no
 * business logic here, just translating the event's fields into
 * `RecordAdminAuditLogData` and delegating to the existing repository.
 *
 * `metadata` reproduces each use case's own pre-Module-37 metadata byte for
 * byte: `{ documentCount }` for SUBMITTED/RESUBMITTED,
 * `{ professionalProfileId }` for APPROVED/REJECTED/RESUBMISSION_REQUESTED.
 *
 * Registered against the shared `eventBus`
 * (`infrastructure/events/compose.ts`) from `verification/compose.ts`,
 * following the exact registration pattern `admin/compose.ts` documents.
 *
 * A thrown error here is caught by `SynchronousEventBus.publish` and
 * surfaces to the publishing use case as part of an `EventDispatchError` —
 * it never corrupts the verification's already-persisted status change.
 */
export class RecordProfessionalVerificationAuditLogSubscriber
  implements EventHandler<ProfessionalVerificationStatusChanged>
{
  constructor(private readonly auditLog: AdminAuditLogRepository) {}

  async handle(event: ProfessionalVerificationStatusChanged): Promise<void> {
    const metadata =
      event.transition === "SUBMITTED" || event.transition === "RESUBMITTED"
        ? { documentCount: event.documentCount }
        : { professionalProfileId: event.professionalProfileId };

    await this.auditLog.record({
      adminUserId: event.actorUserId,
      action: ACTION_FOR_TRANSITION[event.transition],
      targetType: "ProfessionalVerification",
      targetId: event.verificationId,
      metadata,
    });
  }
}
