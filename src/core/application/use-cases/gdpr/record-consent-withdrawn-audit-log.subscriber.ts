import type { AdminAuditLogRepository } from "@/domain/repositories/admin-audit-log-repository";
import type { ConsentWithdrawn } from "@/domain/events/consent-withdrawn";
import type { EventHandler } from "@/application/ports/event-bus";

/**
 * Module 38 — GDPR Compliance: audit-log subscriber for `ConsentWithdrawn`.
 * Registered against the shared `eventBus` from `gdpr/compose.ts`.
 */
export class RecordConsentWithdrawnAuditLogSubscriber implements EventHandler<ConsentWithdrawn> {
  constructor(private readonly auditLog: AdminAuditLogRepository) {}

  async handle(event: ConsentWithdrawn): Promise<void> {
    await this.auditLog.record({
      adminUserId: event.userId,
      action: "GDPR_CONSENT_WITHDRAWN",
      targetType: "Consent",
      targetId: event.consentId,
      metadata: { type: event.type },
    });
  }
}
