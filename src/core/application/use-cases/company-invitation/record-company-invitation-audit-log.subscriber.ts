import type { AdminAuditAction, AdminAuditLogRepository } from "@/domain/repositories/admin-audit-log-repository";
import type { CompanyInvitationStatusChanged } from "@/domain/events/company-invitation-status-changed";
import type { EventHandler } from "@/application/ports/event-bus";

const ACTION_FOR_TRANSITION: Record<CompanyInvitationStatusChanged["transition"], AdminAuditAction> = {
  CREATED: "COMPANY_MEMBER_INVITED",
  ACCEPTED: "COMPANY_INVITATION_ACCEPTED",
  DECLINED: "COMPANY_INVITATION_DECLINED",
};

/**
 * Module 37 — Domain Event Subscribers (Notifications & Audit Log).
 *
 * The `AuditLogSubscriber` for `CompanyInvitationStatusChanged`
 * (`domain/events/company-invitation-status-changed.ts`) — mirrors
 * `RecordProfessionalVerificationAuditLogSubscriber` exactly. Reacts to the
 * event by writing exactly the same `AdminAuditLogRepository.record` call
 * `CreateCompanyInvitationUseCase`/`AcceptCompanyInvitationUseCase`/
 * `DeclineCompanyInvitationUseCase` used to make directly — no business
 * logic here, just translating the event's fields into
 * `RecordAdminAuditLogData` and delegating to the existing repository.
 *
 * `metadata` reproduces each use case's own pre-Module-37 metadata byte for
 * byte: `{ companyId, email, role }` for `CREATED`, `{ companyId, role }`
 * for `ACCEPTED`, `{ companyId }` for `DECLINED`.
 *
 * `CancelCompanyInvitationUseCase` (CANCELLED) is NOT covered by this
 * subscriber — it still writes its `COMPANY_INVITATION_CANCELLED` entry
 * directly, unchanged (see the event's own doc comment for why).
 *
 * Registered against the shared `eventBus`
 * (`infrastructure/events/compose.ts`) from `company-invitation/compose.ts`,
 * following the exact registration pattern `verification/compose.ts`
 * documents.
 *
 * A thrown error here is caught by `SynchronousEventBus.publish` and
 * surfaces to the publishing use case as part of an `EventDispatchError` —
 * it never corrupts the invitation's already-persisted state change.
 */
export class RecordCompanyInvitationAuditLogSubscriber implements EventHandler<CompanyInvitationStatusChanged> {
  constructor(private readonly auditLog: AdminAuditLogRepository) {}

  async handle(event: CompanyInvitationStatusChanged): Promise<void> {
    const metadata =
      event.transition === "CREATED"
        ? { companyId: event.companyId, email: event.email, role: event.role }
        : event.transition === "ACCEPTED"
          ? { companyId: event.companyId, role: event.role }
          : { companyId: event.companyId };

    await this.auditLog.record({
      adminUserId: event.actorUserId,
      action: ACTION_FOR_TRANSITION[event.transition],
      targetType: "CompanyInvitation",
      targetId: event.invitationId,
      metadata,
    });
  }
}
