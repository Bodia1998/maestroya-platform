import type { AdminAuditAction, AdminAuditLogRepository } from "@/domain/repositories/admin-audit-log-repository";
import type { CompanyMembershipChanged } from "@/domain/events/company-membership-changed";
import type { EventHandler } from "@/application/ports/event-bus";

const ACTION_FOR_TRANSITION: Record<CompanyMembershipChanged["transition"], AdminAuditAction> = {
  ROLE_CHANGED: "COMPANY_MEMBER_ROLE_CHANGED",
  REMOVED: "COMPANY_MEMBER_REMOVED",
  OWNERSHIP_TRANSFERRED: "COMPANY_OWNERSHIP_TRANSFERRED",
};

/**
 * Module 37 — Domain Event Subscribers (Notifications & Audit Log).
 *
 * The `AuditLogSubscriber` for `CompanyMembershipChanged`
 * (`domain/events/company-membership-changed.ts`) — mirrors
 * `RecordProfessionalVerificationAuditLogSubscriber` exactly. Reacts to the
 * event by writing exactly the same `AdminAuditLogRepository.record` call
 * `ChangeCompanyMemberRoleUseCase`/`RemoveCompanyMemberUseCase`/
 * `TransferCompanyOwnershipUseCase` used to make directly — no business
 * logic here, just translating the event's fields into
 * `RecordAdminAuditLogData` and delegating to the existing repository.
 *
 * `targetType`/`targetId` differ by transition, matching each source use
 * case's own pre-Module-37 call exactly: `ROLE_CHANGED`/`REMOVED` target
 * `"CompanyMember"`/`event.memberId`; `OWNERSHIP_TRANSFERRED` targets
 * `"Company"`/`event.companyId` (see the event's own doc comment for why).
 * `metadata` reproduces each use case's own pre-Module-37 metadata byte for
 * byte: `{ companyId, fromRole: previousRole, toRole: newRole }` for
 * `ROLE_CHANGED`, `{ companyId, role: previousRole, selfRemoval }` for
 * `REMOVED`, `{ fromUserId: actorUserId, toUserId: targetUserId }` for
 * `OWNERSHIP_TRANSFERRED`.
 *
 * Registered against the shared `eventBus`
 * (`infrastructure/events/compose.ts`) from `company-membership/compose.ts`,
 * following the exact registration pattern `verification/compose.ts`
 * documents.
 *
 * A thrown error here is caught by `SynchronousEventBus.publish` and
 * surfaces to the publishing use case as part of an `EventDispatchError` —
 * it never corrupts the membership change that's already persisted.
 */
export class RecordCompanyMembershipAuditLogSubscriber implements EventHandler<CompanyMembershipChanged> {
  constructor(private readonly auditLog: AdminAuditLogRepository) {}

  async handle(event: CompanyMembershipChanged): Promise<void> {
    if (event.transition === "OWNERSHIP_TRANSFERRED") {
      await this.auditLog.record({
        adminUserId: event.actorUserId,
        action: ACTION_FOR_TRANSITION[event.transition],
        targetType: "Company",
        targetId: event.companyId,
        metadata: { fromUserId: event.actorUserId, toUserId: event.targetUserId },
      });
      return;
    }

    const metadata =
      event.transition === "ROLE_CHANGED"
        ? { companyId: event.companyId, fromRole: event.previousRole, toRole: event.newRole }
        : { companyId: event.companyId, role: event.previousRole, selfRemoval: event.selfRemoval };

    await this.auditLog.record({
      adminUserId: event.actorUserId,
      action: ACTION_FOR_TRANSITION[event.transition],
      targetType: "CompanyMember",
      targetId: event.memberId,
      metadata,
    });
  }
}
