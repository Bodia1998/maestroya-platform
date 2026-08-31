import { describe, expect, it } from "vitest";

import { AlertOnCriticalDiscrepancySubscriber } from "@/application/use-cases/reconciliation/alert-on-critical-discrepancy.subscriber";
import { DiscrepancyDetected } from "@/domain/events/discrepancy-detected";
import type {
  AdminAuditLogRepository,
  AdminAuditLogRecord,
  ListAdminAuditLogsOptions,
  RecordAdminAuditLogData,
} from "@/domain/repositories/admin-audit-log-repository";
import type { ErrorReportContext, ErrorReporter } from "@/application/ports/error-reporter";

class RecordingErrorReporter implements ErrorReporter {
  exceptions: Array<{ error: unknown; context?: ErrorReportContext }> = [];
  messages: Array<{ message: string; context?: ErrorReportContext }> = [];

  reportException(error: unknown, context?: ErrorReportContext): void {
    this.exceptions.push({ error, context });
  }

  reportMessage(message: string, context?: ErrorReportContext): void {
    this.messages.push({ message, context });
  }
}

class FakeAdminAuditLogRepository implements AdminAuditLogRepository {
  entries: AdminAuditLogRecord[] = [];

  async record(data: RecordAdminAuditLogData): Promise<AdminAuditLogRecord> {
    const record: AdminAuditLogRecord = {
      id: `audit-${this.entries.length + 1}`,
      adminUserId: data.adminUserId,
      action: data.action as AdminAuditLogRecord["action"],
      targetType: data.targetType,
      targetId: data.targetId,
      metadata: data.metadata ?? null,
      createdAt: new Date(),
    };
    this.entries.push(record);
    return record;
  }

  async list(_options: ListAdminAuditLogsOptions): Promise<AdminAuditLogRecord[]> {
    return this.entries;
  }
}

describe("AlertOnCriticalDiscrepancySubscriber", () => {
  it("reports and audit-logs a CRITICAL discrepancy", async () => {
    const errorReporter = new RecordingErrorReporter();
    const auditLog = new FakeAdminAuditLogRepository();
    const subscriber = new AlertOnCriticalDiscrepancySubscriber(errorReporter, auditLog);

    const event = new DiscrepancyDetected("disc-1", "run-1", "PAYOUT_EXCEEDS_PAYABLE_AMOUNT", "CRITICAL", "PAYOUT", "entity-1", "job-1");
    await subscriber.handle(event);

    expect(errorReporter.messages).toHaveLength(1);
    expect(errorReporter.messages[0]!.message).toContain("PAYOUT_EXCEEDS_PAYABLE_AMOUNT");
    expect(errorReporter.messages[0]!.context?.tags?.severity).toBe("CRITICAL");
    expect(errorReporter.messages[0]!.context?.extra?.discrepancyId).toBe("disc-1");

    expect(auditLog.entries).toHaveLength(1);
    expect(auditLog.entries[0]!.action).toBe("RECONCILIATION_CRITICAL_DISCREPANCY_ALERTED");
    expect(auditLog.entries[0]!.targetType).toBe("ReconciliationDiscrepancy");
    expect(auditLog.entries[0]!.targetId).toBe("disc-1");
    expect(auditLog.entries[0]!.adminUserId).toBeNull();
  });

  it("does not alert for WARNING/ERROR/INFO severities — only persisted, never paged", async () => {
    const errorReporter = new RecordingErrorReporter();
    const auditLog = new FakeAdminAuditLogRepository();
    const subscriber = new AlertOnCriticalDiscrepancySubscriber(errorReporter, auditLog);

    for (const severity of ["INFO", "WARNING", "ERROR"] as const) {
      const event = new DiscrepancyDetected("disc-x", "run-1", "INVOICE_NUMBERING_ANOMALY", severity, "INVOICE", null, null);
      await subscriber.handle(event);
    }

    expect(errorReporter.messages).toHaveLength(0);
    expect(auditLog.entries).toHaveLength(0);
  });

  it("alerts independently per discrepancy id — two different CRITICAL discrepancies each get their own alert", async () => {
    const errorReporter = new RecordingErrorReporter();
    const auditLog = new FakeAdminAuditLogRepository();
    const subscriber = new AlertOnCriticalDiscrepancySubscriber(errorReporter, auditLog);

    await subscriber.handle(new DiscrepancyDetected("disc-1", "run-1", "DUPLICATE_PAYOUT", "CRITICAL", "PAYOUT", "e1", "j1"));
    await subscriber.handle(new DiscrepancyDetected("disc-2", "run-1", "DUPLICATE_REFUND", "CRITICAL", "REFUND", "e2", "j2"));

    expect(errorReporter.messages).toHaveLength(2);
    expect(auditLog.entries.map((e) => e.targetId)).toEqual(["disc-1", "disc-2"]);
  });
});
