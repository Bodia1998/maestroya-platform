import { describe, expect, it } from "vitest";

import { StartReconciliationRunUseCase } from "@/application/use-cases/reconciliation/start-reconciliation-run.use-case";
import { ResolveDiscrepancyUseCase } from "@/application/use-cases/reconciliation/resolve-discrepancy.use-case";
import { AlertOnCriticalDiscrepancySubscriber } from "@/application/use-cases/reconciliation/alert-on-critical-discrepancy.subscriber";
import { DiscrepancyDetected } from "@/domain/events/discrepancy-detected";
import { SynchronousEventBus } from "@/infrastructure/events/synchronous-event-bus";
import type { StartReconciliationRunInput } from "@/application/dto/reconciliation.dto";
import type { ErrorReportContext, ErrorReporter } from "@/application/ports/error-reporter";
import type { FailureReporter } from "@/application/ports/failure-reporter";
import type {
  AdminAuditLogRepository,
  AdminAuditLogRecord,
  ListAdminAuditLogsOptions,
  RecordAdminAuditLogData,
} from "@/domain/repositories/admin-audit-log-repository";
import { makeContext, makePayout } from "../../../domain/reconciliation/fixtures";
import {
  FakeProviderFinancialReconciliationPort,
  FakeReconciliationDataSource,
  FakeReconciliationDiscrepancyRepository,
  FakeReconciliationRunRepository,
} from "./fakes";

/**
 * Module 90 — Automated Reconciliation & Financial Alerting.
 *
 * End-to-end coverage for the piece Module 80's own test suite could not
 * exercise (it predates this alerting path): a CRITICAL discrepancy,
 * detected by the real reconciliation engine, correctly triggers exactly
 * one operational alert — deduplicated across repeated runs, isolated
 * from alert-delivery failure, and correctly restarted after resolution
 * and reappearance. Uses the real `SynchronousEventBus` (not the
 * `FakeEventBus` the sibling use-case test file uses), because this
 * suite specifically needs the platform's actual handler-failure
 * isolation contract (`EventDispatchError` + `FailureReporter` —
 * see `synchronous-event-bus.ts`), which a bare fake bus does not
 * reproduce.
 */

class RecordingErrorReporter implements ErrorReporter {
  messages: Array<{ message: string; context?: ErrorReportContext }> = [];
  reportException(): void {}
  reportMessage(message: string, context?: ErrorReportContext): void {
    this.messages.push({ message, context });
  }
}

class RecordingFailureReporter implements FailureReporter {
  reports: Array<{ error: unknown; context?: Record<string, unknown> }> = [];
  report(error: unknown, context?: Record<string, unknown>): void {
    this.reports.push({ error, context });
  }
}

class FakeAdminAuditLogRepository implements AdminAuditLogRepository {
  entries: AdminAuditLogRecord[] = [];
  failNext = false;

  async record(data: RecordAdminAuditLogData): Promise<AdminAuditLogRecord> {
    if (this.failNext) {
      this.failNext = false;
      throw new Error("audit log store unavailable");
    }
    const record: AdminAuditLogRecord = {
      id: `audit-${this.entries.length + 1}`,
      adminUserId: data.adminUserId,
      action: data.action,
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

function makeInput(overrides: Partial<StartReconciliationRunInput> = {}): StartReconciliationRunInput {
  return { scope: "PAYOUT", limit: 500, ...overrides };
}

function makeHarness() {
  const dataSource = new FakeReconciliationDataSource();
  const runs = new FakeReconciliationRunRepository();
  const discrepancies = new FakeReconciliationDiscrepancyRepository();
  const provider = new FakeProviderFinancialReconciliationPort();
  const eventBus = new SynchronousEventBus();
  const failureReporter = new RecordingFailureReporter();
  const errorReporter = new RecordingErrorReporter();
  const auditLog = new FakeAdminAuditLogRepository();

  eventBus.subscribe(DiscrepancyDetected, new AlertOnCriticalDiscrepancySubscriber(errorReporter, auditLog));

  const useCase = new StartReconciliationRunUseCase(dataSource, runs, discrepancies, provider, eventBus, failureReporter);
  const resolveUseCase = new ResolveDiscrepancyUseCase(discrepancies, eventBus, failureReporter);

  return { dataSource, runs, discrepancies, provider, eventBus, failureReporter, errorReporter, auditLog, useCase, resolveUseCase };
}

/** A payout paid out for more than Payment.amount - Commission.amount is
 *  always CRITICAL (`PAYOUT_EXCEEDS_PAYABLE_AMOUNT`) — see `severity.ts`. */
function seedCriticalPayoutDiscrepancy(dataSource: FakeReconciliationDataSource, jobId = "job-1"): void {
  dataSource.seed(jobId, makeContext({ payout: makePayout({ amount: 950 }) }));
}

describe("Module 90 — automated critical-discrepancy alerting (end to end)", () => {
  it("generates exactly one alert (Sentry report + audit log entry) when a CRITICAL discrepancy is first detected", async () => {
    const { dataSource, useCase, errorReporter, auditLog } = makeHarness();
    seedCriticalPayoutDiscrepancy(dataSource);

    const summary = await useCase.execute(makeInput(), null);

    expect(summary.run.status).toBe("COMPLETED");
    expect(summary.discrepanciesCreated).toBe(1);
    expect(errorReporter.messages).toHaveLength(1);
    expect(errorReporter.messages[0]!.context?.tags?.category).toBe("PAYOUT_EXCEEDS_PAYABLE_AMOUNT");
    expect(auditLog.entries).toHaveLength(1);
    expect(auditLog.entries[0]!.action).toBe("RECONCILIATION_CRITICAL_DISCREPANCY_ALERTED");
  });

  it("does not duplicate the alert on repeated runs against the same still-open discrepancy (scheduled re-detection)", async () => {
    const { dataSource, useCase, errorReporter, auditLog } = makeHarness();
    seedCriticalPayoutDiscrepancy(dataSource);

    await useCase.execute(makeInput(), null);
    await useCase.execute(makeInput(), null);
    await useCase.execute(makeInput(), null);

    expect(errorReporter.messages).toHaveLength(1);
    expect(auditLog.entries).toHaveLength(1);
  });

  it("starts a new alert cycle when a resolved discrepancy's underlying condition reappears", async () => {
    const { dataSource, discrepancies, useCase, resolveUseCase, errorReporter, auditLog } = makeHarness();
    seedCriticalPayoutDiscrepancy(dataSource);

    await useCase.execute(makeInput(), null);
    expect(errorReporter.messages).toHaveLength(1);

    const [discrepancy] = [...discrepancies.byId.values()];
    await resolveUseCase.execute(discrepancy!.id, "admin-1", "Payout correction confirmed manually");

    // The same fingerprint reappears on the next scan (nothing about the
    // underlying data changed) — `createOrTouch` must insert a brand-new
    // OPEN row (the old one is RESOLVED, not OPEN), so DiscrepancyDetected
    // fires again and a second, independent alert cycle begins.
    await useCase.execute(makeInput(), null);

    expect(errorReporter.messages).toHaveLength(2);
    expect(auditLog.entries).toHaveLength(2);
    expect([...discrepancies.byId.values()]).toHaveLength(2);
  });

  it("never loses the discrepancy when alert delivery fails — the discrepancy stays persisted and the run stays COMPLETED", async () => {
    const { dataSource, discrepancies, useCase, auditLog, errorReporter, failureReporter } = makeHarness();
    seedCriticalPayoutDiscrepancy(dataSource);
    auditLog.failNext = true;

    const summary = await useCase.execute(makeInput(), null);

    // The reconciliation run and the discrepancy's persistence are wholly
    // unaffected by the alert handler throwing.
    expect(summary.run.status).toBe("COMPLETED");
    expect(summary.discrepanciesCreated).toBe(1);
    expect([...discrepancies.byId.values()]).toHaveLength(1);
    expect([...discrepancies.byId.values()][0]!.resolutionStatus).toBe("OPEN");

    // The Sentry report was still attempted before the audit-log write
    // that failed — a partial delivery, not silence.
    expect(errorReporter.messages).toHaveLength(1);
    // No audit-log entry made it through this attempt...
    expect(auditLog.entries).toHaveLength(0);
    // ...but the failure itself is separately observable, never swallowed
    // without a trace.
    expect(failureReporter.reports).toHaveLength(1);
  });

  it("retry is possible after an alert-delivery failure: the next detection cycle for the same still-open discrepancy is not itself blocked", async () => {
    const { dataSource, useCase, auditLog, errorReporter } = makeHarness();
    seedCriticalPayoutDiscrepancy(dataSource);
    auditLog.failNext = true;

    await useCase.execute(makeInput(), null); // alert delivery fails once
    expect(auditLog.entries).toHaveLength(0);

    // A still-OPEN discrepancy is only re-confirmed (no new
    // DiscrepancyDetected), so this does not itself constitute the
    // "retry" — it demonstrates the run keeps working correctly
    // regardless. Real retry of the failed alert is the platform's
    // existing queued-event-bus attempts/backoff (EVENT_QUEUE_ENABLED),
    // documented on the subscriber itself.
    const second = await useCase.execute(makeInput(), null);
    expect(second.run.status).toBe("COMPLETED");
    expect(errorReporter.messages).toHaveLength(1); // still just the first attempt's report
  });

  it("marks the reconciliation run FAILED (never a clean COMPLETED) when the engine itself throws — independent of alerting entirely", async () => {
    const { dataSource, useCase, discrepancies } = makeHarness();
    // No seed at all — force the data source itself to misbehave instead.
    dataSource.listJobIdsToInspect = async () => {
      throw new Error("database unavailable");
    };

    const summary = await useCase.execute(makeInput(), null);

    expect(summary.run.status).toBe("FAILED");
    expect(discrepancies.byId.size).toBe(0);
  });
});
