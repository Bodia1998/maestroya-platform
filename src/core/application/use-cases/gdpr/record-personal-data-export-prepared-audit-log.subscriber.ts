import type { AdminAuditLogRepository } from "@/domain/repositories/admin-audit-log-repository";
import type { PersonalDataExportPrepared } from "@/domain/events/personal-data-export-prepared";
import type { EventHandler } from "@/application/ports/event-bus";

/**
 * Module 38 — GDPR Compliance: audit-log subscriber for
 * `PersonalDataExportPrepared`. Registered against the shared `eventBus`
 * from `gdpr/compose.ts`.
 */
export class RecordPersonalDataExportPreparedAuditLogSubscriber
  implements EventHandler<PersonalDataExportPrepared>
{
  constructor(private readonly auditLog: AdminAuditLogRepository) {}

  async handle(event: PersonalDataExportPrepared): Promise<void> {
    await this.auditLog.record({
      adminUserId: event.actorUserId,
      action: "GDPR_EXPORT_PREPARED",
      targetType: "User",
      targetId: event.userId,
      metadata: { userId: event.userId, categoryCounts: event.categoryCounts },
    });
  }
}
