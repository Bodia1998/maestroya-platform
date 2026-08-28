import { randomUUID } from "node:crypto";

import type {
  CompleteReconciliationRunData,
  CreateDiscrepancyData,
  FailReconciliationRunData,
  ListDiscrepanciesForRunOptions,
  ListReconciliationRunsOptions,
  ListUnresolvedDiscrepanciesOptions,
  ReconciliationDiscrepancyRecord,
  ReconciliationDiscrepancyRepository,
  ReconciliationRunRecord,
  ReconciliationRunRepository,
  ResolveDiscrepancyData,
  StartReconciliationRunData,
} from "@/domain/repositories/reconciliation-repository";
import type {
  ListJobsForReconciliationOptions,
  ReconciliationDataSource,
} from "@/application/ports/reconciliation-data-source";
import type { ProviderFinancialReconciliationPort } from "@/application/ports/provider-financial-reconciliation";
import type { ProviderState } from "@/domain/services/reconciliation/provider-checks";
import type { JobFinancialContext } from "@/domain/services/reconciliation/context";
import type { DomainEvent, DomainEventClass } from "@/domain/events/domain-event";
import type { EventBus, EventHandler } from "@/application/ports/event-bus";

/**
 * Module 80 — Financial Reconciliation & Observability: in-memory fakes
 * for this module's own use-case orchestration tests — same "one fakes
 * set per module's own test directory" convention
 * `tests/unit/core/application/use-cases/invoicing/fakes.ts` already
 * establishes.
 */

export class FakeReconciliationDataSource implements ReconciliationDataSource {
  private jobIds: string[] = [];
  private contexts = new Map<string, JobFinancialContext>();

  seed(jobId: string, context: JobFinancialContext): void {
    if (!this.jobIds.includes(jobId)) this.jobIds.push(jobId);
    this.contexts.set(jobId, context);
  }

  async listJobIdsToInspect(options: ListJobsForReconciliationOptions): Promise<string[]> {
    return this.jobIds.slice(0, options.limit);
  }

  async getJobFinancialContext(jobId: string): Promise<JobFinancialContext | null> {
    return this.contexts.get(jobId) ?? null;
  }
}

export class FakeReconciliationRunRepository implements ReconciliationRunRepository {
  byId = new Map<string, ReconciliationRunRecord>();

  async findById(id: string): Promise<ReconciliationRunRecord | null> {
    return this.byId.get(id) ?? null;
  }

  async list(options: ListReconciliationRunsOptions): Promise<ReconciliationRunRecord[]> {
    const all = [...this.byId.values()].filter((r) => !options.status || r.status === options.status);
    return all.slice(options.offset, options.offset + options.limit);
  }

  async start(data: StartReconciliationRunData): Promise<ReconciliationRunRecord> {
    const record: ReconciliationRunRecord = {
      id: data.id,
      scope: data.scope,
      status: "RUNNING",
      startedAt: data.startedAt,
      completedAt: null,
      durationMs: null,
      recordsInspected: 0,
      discrepancyCount: 0,
      errorMessage: null,
      parametersHash: data.parametersHash,
      triggeredByUserId: data.triggeredByUserId,
      createdAt: data.startedAt,
    };
    this.byId.set(data.id, record);
    return record;
  }

  async complete(data: CompleteReconciliationRunData): Promise<ReconciliationRunRecord> {
    const existing = this.byId.get(data.id);
    if (!existing) throw new Error(`No such run: ${data.id}`);
    if (existing.status !== "RUNNING") throw new Error(`Run ${data.id} is not RUNNING (status=${existing.status})`);
    const updated: ReconciliationRunRecord = {
      ...existing,
      status: "COMPLETED",
      completedAt: data.completedAt,
      durationMs: data.durationMs,
      recordsInspected: data.recordsInspected,
      discrepancyCount: data.discrepancyCount,
    };
    this.byId.set(data.id, updated);
    return updated;
  }

  async fail(data: FailReconciliationRunData): Promise<ReconciliationRunRecord> {
    const existing = this.byId.get(data.id);
    if (!existing) throw new Error(`No such run: ${data.id}`);
    if (existing.status !== "RUNNING") throw new Error(`Run ${data.id} is not RUNNING (status=${existing.status})`);
    const updated: ReconciliationRunRecord = {
      ...existing,
      status: "FAILED",
      completedAt: data.completedAt,
      durationMs: data.durationMs,
      recordsInspected: data.recordsInspected,
      errorMessage: data.errorMessage,
    };
    this.byId.set(data.id, updated);
    return updated;
  }
}

export class FakeReconciliationDiscrepancyRepository implements ReconciliationDiscrepancyRepository {
  byId = new Map<string, ReconciliationDiscrepancyRecord>();
  private byFingerprint = new Map<string, string>();

  async findById(id: string): Promise<ReconciliationDiscrepancyRecord | null> {
    return this.byId.get(id) ?? null;
  }

  async findOpenByFingerprint(fingerprint: string): Promise<ReconciliationDiscrepancyRecord | null> {
    const id = this.byFingerprint.get(fingerprint);
    if (!id) return null;
    const record = this.byId.get(id);
    return record && record.resolutionStatus === "OPEN" ? record : null;
  }

  async listForRun(options: ListDiscrepanciesForRunOptions): Promise<ReconciliationDiscrepancyRecord[]> {
    const all = [...this.byId.values()].filter((d) => d.detectedByRunId === options.runId);
    return all.slice(options.offset, options.offset + options.limit);
  }

  async listUnresolved(options: ListUnresolvedDiscrepanciesOptions): Promise<ReconciliationDiscrepancyRecord[]> {
    const rank: Record<string, number> = { INFO: 0, WARNING: 1, ERROR: 2, CRITICAL: 3 };
    const minRank = options.minSeverity ? (rank[options.minSeverity] ?? 0) : 0;
    const all = [...this.byId.values()].filter((d) => d.resolutionStatus === "OPEN" && (rank[d.severity] ?? 0) >= minRank);
    return all.slice(options.offset, options.offset + options.limit);
  }

  /** Mirrors the real `PrismaReconciliationDiscrepancyRepository.createOrTouch`:
   *  fast-paths on an already-open discrepancy with the same fingerprint
   *  (updates `lastSeenRunId`/`updatedAt` instead of inserting a new row),
   *  otherwise creates a brand new OPEN row — see that repository's own
   *  idempotency doc comment, which this fake exists to let the use-case
   *  test exercise without a real database.
   *
   *  The existing-row lookup below is deliberately synchronous (no
   *  `await` between checking `byFingerprint` and writing to it) even
   *  though the method itself is `async` — that's what makes two
   *  concurrent callers racing on the same fingerprint behave like the
   *  real repository's unique-constraint-backed `createOrTouch` (one
   *  wins the insert, the other observes it and touches instead) rather
   *  than both slipping through a check-then-act gap and inserting two
   *  rows for the same underlying condition. A version of this fake that
   *  `await`ed the lookup before deciding would reintroduce exactly the
   *  race the real DB-level partial unique index exists to close. */
  async createOrTouch(data: CreateDiscrepancyData): Promise<{ record: ReconciliationDiscrepancyRecord; created: boolean }> {
    const existingId = this.byFingerprint.get(data.fingerprint);
    const existing = existingId ? this.byId.get(existingId) : undefined;
    if (existing && existing.resolutionStatus === "OPEN") {
      const touched: ReconciliationDiscrepancyRecord = {
        ...existing,
        lastSeenRunId: data.detectedByRunId,
        expectedValue: data.expectedValue,
        actualValue: data.actualValue,
        differenceValue: data.differenceValue,
        explanation: data.explanation,
        updatedAt: new Date(),
      };
      this.byId.set(existing.id, touched);
      return { record: touched, created: false };
    }

    const record: ReconciliationDiscrepancyRecord = {
      id: data.id,
      detectedByRunId: data.detectedByRunId,
      lastSeenRunId: data.detectedByRunId,
      entityType: data.entityType,
      entityId: data.entityId,
      jobId: data.jobId,
      paymentId: data.paymentId,
      invoiceId: data.invoiceId,
      payoutId: data.payoutId,
      refundId: data.refundId,
      creditNoteId: data.creditNoteId,
      category: data.category,
      severity: data.severity,
      expectedValue: data.expectedValue,
      actualValue: data.actualValue,
      differenceValue: data.differenceValue,
      currency: data.currency,
      explanation: data.explanation,
      fingerprint: data.fingerprint,
      resolutionStatus: "OPEN",
      resolution: null,
      detectedAt: data.detectedAt,
      updatedAt: data.detectedAt,
    };
    this.byId.set(record.id, record);
    this.byFingerprint.set(data.fingerprint, record.id);
    return { record, created: true };
  }

  async resolve(data: ResolveDiscrepancyData): Promise<ReconciliationDiscrepancyRecord> {
    const existing = this.byId.get(data.id);
    if (!existing) throw new Error(`No such discrepancy: ${data.id}`);
    const resolved: ReconciliationDiscrepancyRecord = {
      ...existing,
      resolutionStatus: "RESOLVED",
      resolution: {
        resolvedByUserId: data.resolvedByUserId,
        resolvedAt: data.resolvedAt,
        reason: data.reason,
        metadata: data.metadata,
      },
      updatedAt: data.resolvedAt,
    };
    this.byId.set(data.id, resolved);
    return resolved;
  }
}

export class FakeProviderFinancialReconciliationPort implements ProviderFinancialReconciliationPort {
  paymentStates = new Map<string, ProviderState | null>();
  transferStates = new Map<string, ProviderState | null>();
  refundStates = new Map<string, ProviderState | null>();

  async retrievePaymentState(id: string): Promise<ProviderState | null> {
    return this.paymentStates.has(id) ? (this.paymentStates.get(id) ?? null) : null;
  }
  async retrieveTransferState(id: string): Promise<ProviderState | null> {
    return this.transferStates.has(id) ? (this.transferStates.get(id) ?? null) : null;
  }
  async retrieveRefundState(id: string): Promise<ProviderState | null> {
    return this.refundStates.has(id) ? (this.refundStates.get(id) ?? null) : null;
  }
}

export class FakeEventBus implements EventBus {
  published: DomainEvent[] = [];
  private handlers = new Map<string, EventHandler[]>();

  async publish<T extends DomainEvent>(event: T): Promise<void> {
    this.published.push(event);
    const list = this.handlers.get(event.eventName) ?? [];
    for (const handler of list) {
      await handler.handle(event);
    }
  }

  async publishAll(events: DomainEvent[]): Promise<void> {
    for (const event of events) await this.publish(event);
  }

  subscribe<T extends DomainEvent>(eventType: DomainEventClass<T>, handler: EventHandler<T>): void {
    const list = this.handlers.get(eventType.eventName) ?? [];
    list.push(handler as EventHandler);
    this.handlers.set(eventType.eventName, list);
  }
}

export function newDiscrepancyId(): string {
  return randomUUID();
}
