import type { AdminAuditLogRepository } from "@/domain/repositories/admin-audit-log-repository";
import type { PersonalDataExportRequested } from "@/domain/events/personal-data-export-requested";
import type { EventHandler } from "@/application/ports/event-bus";

/**
 * Module 38 — GDPR Compliance: audit-log subscriber for
 * `PersonalDataExportRequested`, same "reproduce what the use case used to
 * write inline" pattern as `RecordDisputeCreatedAuditLogSubscriber`.
 * Registered against the shared `eventBus` from `gdpr/compose.ts`.
 */
export class RecordPersonalDataExportRequestedAuditLogSubscriber
  implements EventHandler<PersonalDataExportRequested>
{
  constructor(private readonly auditLog: AdminAuditLogRepository) {}

  async handle(event: PersonalDataExportRequested): Promise<void> {
    await this.auditLog.record({
      adminUserId: event.actorUserId,
      action: "GDPR_EXPORT_REQUESTED",
      targetType: "User",
      targetId: event.userId,
      metadata: { userId: event.userId },
    });
  }
}
