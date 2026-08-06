import type { AdminAuditLogRepository } from "@/domain/repositories/admin-audit-log-repository";
import type { ConsentGranted } from "@/domain/events/consent-granted";
import type { EventHandler } from "@/application/ports/event-bus";

/**
 * Module 38 — GDPR Compliance: audit-log subscriber for `ConsentGranted`.
 * Registered against the shared `eventBus` from `gdpr/compose.ts`.
 */
export class RecordConsentGrantedAuditLogSubscriber implements EventHandler<ConsentGranted> {
  constructor(private readonly auditLog: AdminAuditLogRepository) {}

  async handle(event: ConsentGranted): Promise<void> {
    await this.auditLog.record({
      adminUserId: event.userId,
      action: "GDPR_CONSENT_GRANTED",
      targetType: "Consent",
      targetId: event.consentId,
      metadata: { type: event.type, version: event.version },
    });
  }
}
