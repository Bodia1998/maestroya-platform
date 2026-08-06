import type { AdminAuditLogRepository } from "@/domain/repositories/admin-audit-log-repository";
import type { AccountDeletionRequested } from "@/domain/events/account-deletion-requested";
import type { EventHandler } from "@/application/ports/event-bus";

/**
 * Module 38 — GDPR Compliance: audit-log subscriber for
 * `AccountDeletionRequested`. Registered against the shared `eventBus`
 * from `gdpr/compose.ts`.
 */
export class RecordAccountDeletionRequestedAuditLogSubscriber implements EventHandler<AccountDeletionRequested> {
  constructor(private readonly auditLog: AdminAuditLogRepository) {}

  async handle(event: AccountDeletionRequested): Promise<void> {
    await this.auditLog.record({
      adminUserId: event.actorUserId,
      action: "GDPR_DELETION_REQUESTED",
      targetType: "User",
      targetId: event.userId,
      metadata: { userId: event.userId },
    });
  }
}
