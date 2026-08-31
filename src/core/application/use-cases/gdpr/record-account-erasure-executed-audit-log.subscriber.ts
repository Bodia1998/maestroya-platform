import type { AdminAuditLogRepository } from "@/domain/repositories/admin-audit-log-repository";
import type { AccountErasureExecuted } from "@/domain/events/account-erasure-executed";
import type { EventHandler } from "@/application/ports/event-bus";

/**
 * Module 88 — GDPR Erasure Execution & Document Retention: audit-log
 * subscriber for `AccountErasureExecuted`. Registered against the shared
 * `eventBus` from `gdpr/compose.ts`, same pattern as every other
 * Record*AuditLogSubscriber in this module.
 *
 * Metadata is deliberately minimal — category *strategy names* (e.g.
 * `"PROFILE_DATA": "ANONYMIZE"`) and counts only, never the erased user's
 * name/email/phone/address/etc. This satisfies the module's own
 * requirement: the audit record proves erasure happened (what, when, who
 * initiated it, target id, result) without itself becoming a second place
 * the erased PII lives on.
 */
export class RecordAccountErasureExecutedAuditLogSubscriber implements EventHandler<AccountErasureExecuted> {
  constructor(private readonly auditLog: AdminAuditLogRepository) {}

  async handle(event: AccountErasureExecuted): Promise<void> {
    await this.auditLog.record({
      adminUserId: event.actorUserId,
      action: "GDPR_DELETION_EXECUTED",
      targetType: "User",
      targetId: event.userId,
      metadata: {
        alreadyErased: event.alreadyErased,
        categoriesProcessed: event.categoriesProcessed,
        documentsStoragePurgeFailures: event.documentsStoragePurgeFailures,
      },
    });
  }
}
