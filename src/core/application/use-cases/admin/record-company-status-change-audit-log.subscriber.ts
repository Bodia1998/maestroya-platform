import type { AdminAuditAction, AdminAuditLogRepository } from "@/domain/repositories/admin-audit-log-repository";
import type { CompanyStatusChanged } from "@/domain/events/company-status-changed";
import type { EventHandler } from "@/application/ports/event-bus";

const ACTION_FOR_NEW_STATUS: Record<CompanyStatusChanged["newStatus"], AdminAuditAction> = {
  SUSPENDED: "COMPANY_SUSPENDED",
  ACTIVE: "COMPANY_REACTIVATED",
};

/**
 * Module 37 — Domain Event Subscribers (Notifications & Audit Log).
 *
 * The `AuditLogSubscriber` for `CompanyStatusChanged`
 * (`domain/events/company-status-changed.ts`). Reacts to the event by
 * writing exactly the same `AdminAuditLogRepository.record` call
 * `SuspendCompanyUseCase`/`ReactivateCompanyUseCase` used to make
 * directly — no business logic here, just translating the event's fields
 * into `RecordAdminAuditLogData` and delegating to the existing
 * repository. `ACTION_FOR_NEW_STATUS` mirrors those use cases' own
 * previous `action: "COMPANY_SUSPENDED" | "COMPANY_REACTIVATED"` literal.
 *
 * Registered against the shared `eventBus`
 * (`infrastructure/events/compose.ts`) from `admin/compose.ts`, following
 * the exact registration pattern documented on that composition root.
 *
 * A thrown error here (e.g. the audit log write fails) is caught by
 * `SynchronousEventBus.publish` and surfaces to the publishing use case as
 * part of an `EventDispatchError` — it never corrupts the company's
 * already-persisted status change and never throws past `EventBus`'s own
 * dispatch contract (see that class's doc comment).
 */
export class RecordCompanyStatusChangeAuditLogSubscriber implements EventHandler<CompanyStatusChanged> {
  constructor(private readonly auditLog: AdminAuditLogRepository) {}

  async handle(event: CompanyStatusChanged): Promise<void> {
    await this.auditLog.record({
      adminUserId: event.adminUserId,
      action: ACTION_FOR_NEW_STATUS[event.newStatus],
      targetType: "Company",
      targetId: event.companyId,
      metadata: { previousStatus: event.previousStatus },
    });
  }
}
