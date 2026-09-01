import { randomUUID } from "node:crypto";

import type {
  CategoryCount,
  CompleteReconciliationRunData,
  CreateDiscrepancyData,
  DiscrepancySeverityValue,
  FailReconciliationRunData,
  ListDiscrepanciesForRunOptions,
  ListDiscrepanciesOptions,
  ListReconciliationRunsOptions,
  ListUnresolvedDiscrepanciesOptions,
  OpenSeverityCounts,
  ReconciliationDiscrepancyRecord,
  ReconciliationDiscrepancyRepository,
  ReconciliationRunRecord,
  ReconciliationRunRepository,
  ReconciliationRunStatusValue,
  ResolveDiscrepancyData,
  StartReconciliationRunData,
} from "@/domain/repositories/reconciliation-repository";
import type {
  ListJobsForReconciliationCursorOptions,
  ListJobsForReconciliationOptions,
  ReconciliationDataSource,
  ReconciliationJobCursorBatch,
} from "@/application/ports/reconciliation-data-source";
import type { DistributedLock } from "@/application/ports/distributed-lock";
import type {
  AdvanceReconciliationScheduleCursorData,
  ReconciliationScheduleCursorRecord,
  ReconciliationScheduleCursorRepository,
} from "@/domain/repositories/reconciliation-schedule-cursor-repository";
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
  /** Module 92 — the `(createdAt, id)` this fake's
   *  `listJobIdsToInspectFromCursor` orders/pages by, mirroring the real
   *  `PrismaReconciliationDataSource`'s keyset query. Defaults to
   *  insertion order with one-millisecond-apart synthetic timestamps
   *  (see `seed`) so a test that doesn't care about ordering still gets a
   *  strict, collision-free order by default; a test asserting the
   *  timestamp-collision tie-break passes an explicit `createdAt`. */
  private jobCursorFields = new Map<string, { createdAt: Date; id: string }>();
  private nextSyntheticCreatedAtMs = Date.parse("2026-01-01T00:00:00.000Z");

  seed(jobId: string, context: JobFinancialContext, overrides: Partial<{ createdAt: Date }> = {}): void {
    if (!this.jobIds.includes(jobId)) this.jobIds.push(jobId);
    this.contexts.set(jobId, context);
    const createdAt = overrides.createdAt ?? new Date(this.nextSyntheticCreatedAtMs++);
    this.jobCursorFields.set(jobId, { createdAt, id: jobId });
  }

  async listJobIdsToInspect(options: ListJobsForReconciliationOptions): Promise<string[]> {
    return this.jobIds.slice(0, options.limit);
  }

  /** Module 92 — mirrors the real `PrismaReconciliationDataSource.listJobIdsToInspectFromCursor`:
   *  ascending `(createdAt, id)` keyset order, strictly-after `options.after`,
   *  bounded by `options.limit`, with `cycleCompleted` true iff no more
   *  eligible rows remain after this page. */
  async listJobIdsToInspectFromCursor(options: ListJobsForReconciliationCursorOptions): Promise<ReconciliationJobCursorBatch> {
    const ordered = [...this.jobCursorFields.values()].sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id),
    );
    const after = options.after;
    const remaining = after
      ? ordered.filter(
          (row) =>
            row.createdAt.getTime() > after.createdAt.getTime() ||
            (row.createdAt.getTime() === after.createdAt.getTime() && row.id > after.id),
        )
      : ordered;

    const page = remaining.slice(0, options.limit);
    const cycleCompleted = remaining.length <= options.limit;
    const last = page.length > 0 ? page[page.length - 1] : null;

    return {
      jobIds: page.map((r) => r.id),
      nextCursor: last ? { createdAt: last.createdAt, id: last.id } : null,
      cycleCompleted,
    };
  }

  async getJobFinancialContext(jobId: string): Promise<JobFinancialContext | null> {
    return this.contexts.get(jobId) ?? null;
  }
}

/** Module 92 — in-memory `ReconciliationScheduleCursorRepository`, mirroring
 *  the real Prisma repository's "conditional update, returns null on a
 *  version mismatch" contract (see that class's own doc comment) without
 *  a database. */
export class FakeReconciliationScheduleCursorRepository implements ReconciliationScheduleCursorRepository {
  byCursorKey = new Map<string, ReconciliationScheduleCursorRecord>();

  async getOrCreate(cursorKey: string): Promise<ReconciliationScheduleCursorRecord> {
    const existing = this.byCursorKey.get(cursorKey);
    if (existing) return existing;
    const now = new Date();
    const record: ReconciliationScheduleCursorRecord = {
      id: randomUUID(),
      cursorKey,
      lastCreatedAt: null,
      lastJobId: null,
      cycleNumber: 1,
      cycleStartedAt: now,
      lastAdvancedAt: null,
      version: 0,
      createdAt: now,
      updatedAt: now,
    };
    this.byCursorKey.set(cursorKey, record);
    return record;
  }

  async advance(data: AdvanceReconciliationScheduleCursorData): Promise<ReconciliationScheduleCursorRecord | null> {
    const existing = this.byCursorKey.get(data.cursorKey);
    if (!existing || existing.version !== data.expectedVersion) return null;
    const now = new Date();
    const updated: ReconciliationScheduleCursorRecord = {
      ...existing,
      lastCreatedAt: data.lastCreatedAt,
      lastJobId: data.lastJobId,
      cycleNumber: data.cycleNumber,
      cycleStartedAt: data.cycleStartedAt,
      lastAdvancedAt: now,
      version: existing.version + 1,
      updatedAt: now,
    };
    this.byCursorKey.set(data.cursorKey, updated);
    return updated;
  }
}

/** Module 92 — in-memory `DistributedLock`, mirroring the real
 *  `InMemoryLockService`'s "second concurrent acquire on the same key
 *  returns null instead of blocking" contract, for tests that don't need
 *  a real TTL/timer (`withLock` here never self-expires — tests that
 *  need that use the real `InMemoryLockService` directly instead). Also
 *  exposes `nextAcquireFails` so a test can force a "someone else holds
 *  it" outcome without a real second caller. */
export class FakeDistributedLock implements DistributedLock {
  private held = new Set<string>();
  nextAcquireFails = false;
  calls: { key: string; ttlMs: number }[] = [];

  async withLock<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T | null> {
    this.calls.push({ key, ttlMs });
    if (this.nextAcquireFails || this.held.has(key)) return null;
    this.held.add(key);
    try {
      return await fn();
    } finally {
      this.held.delete(key);
    }
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

  // Module 81 — mirrors the real `PrismaReconciliationRunRepository.count`.
  async count(status?: ReconciliationRunStatusValue): Promise<number> {
    return [...this.byId.values()].filter((r) => !status || r.status === status).length;
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

  // Module 81 — mirrors the real repository's own filtered/paginated `list`.
  async list(options: ListDiscrepanciesOptions): Promise<ReconciliationDiscrepancyRecord[]> {
    const rank: Record<string, number> = { INFO: 0, WARNING: 1, ERROR: 2, CRITICAL: 3 };
    const all = [...this.byId.values()]
      .filter((d) => !options.resolutionStatus || d.resolutionStatus === options.resolutionStatus)
      .filter((d) => !options.severity || d.severity === options.severity)
      .filter((d) => !options.category || d.category === options.category)
      .filter((d) => !options.entityType || d.entityType === options.entityType)
      .filter((d) => !options.detectedFrom || d.detectedAt >= options.detectedFrom)
      .filter((d) => !options.detectedTo || d.detectedAt <= options.detectedTo)
      .sort((a, b) => (rank[b.severity] ?? 0) - (rank[a.severity] ?? 0) || b.detectedAt.getTime() - a.detectedAt.getTime());
    return all.slice(options.offset, options.offset + options.limit);
  }

  // Module 81 — mirrors the real repository's own `countByResolutionStatus`.
  async countByResolutionStatus(): Promise<{ open: number; resolved: number }> {
    const all = [...this.byId.values()];
    return {
      open: all.filter((d) => d.resolutionStatus === "OPEN").length,
      resolved: all.filter((d) => d.resolutionStatus === "RESOLVED").length,
    };
  }

  // Module 81 — mirrors the real repository's own `getOpenSeverityCounts`.
  async getOpenSeverityCounts(): Promise<OpenSeverityCounts> {
    const counts: OpenSeverityCounts = { INFO: 0, WARNING: 0, ERROR: 0, CRITICAL: 0 };
    for (const d of this.byId.values()) {
      if (d.resolutionStatus === "OPEN") counts[d.severity as DiscrepancySeverityValue] += 1;
    }
    return counts;
  }

  // Module 81 — mirrors the real repository's own `getOpenCategoryCounts`.
  async getOpenCategoryCounts(): Promise<CategoryCount[]> {
    const counts = new Map<string, number>();
    for (const d of this.byId.values()) {
      if (d.resolutionStatus !== "OPEN") continue;
      counts.set(d.category, (counts.get(d.category) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([category, count]) => ({ category: category as CategoryCount["category"], count }))
      .sort((a, b) => b.count - a.count);
  }

  // Module 81 — mirrors the real repository's own `getSeverityCountsForRun`.
  async getSeverityCountsForRun(runId: string): Promise<OpenSeverityCounts> {
    const counts: OpenSeverityCounts = { INFO: 0, WARNING: 0, ERROR: 0, CRITICAL: 0 };
    for (const d of this.byId.values()) {
      if (d.detectedByRunId === runId) counts[d.severity as DiscrepancySeverityValue] += 1;
    }
    return counts;
  }
}

export class FakeProviderFinancialReconciliationPort implements ProviderFinancialReconciliationPort {
  paymentStates = new Map<string, ProviderState | null>();
  transferStates = new Map<string, ProviderState | null>();
  refundStates = new Map<string, ProviderState | null>();
  /** Module 87 — failure injection, mirroring `FakePaymentGateway.nextError`
   *  (`tests/unit/.../payments/fakes.ts`): lets a test simulate a Stripe
   *  API failure (timeout, 5xx) during reconciliation's PROVIDER checks,
   *  which the plain state maps above cannot express. Keyed by external
   *  reference so a test can fail one reference and not others; a bare
   *  `nextError` (no key) fails every call. */
  nextError: Error | null = null;
  nextErrorFor = new Map<string, Error>();

  private maybeThrow(id: string): void {
    const specific = this.nextErrorFor.get(id);
    if (specific) throw specific;
    if (this.nextError) throw this.nextError;
  }

  async retrievePaymentState(id: string): Promise<ProviderState | null> {
    this.maybeThrow(id);
    return this.paymentStates.has(id) ? (this.paymentStates.get(id) ?? null) : null;
  }
  async retrieveTransferState(id: string): Promise<ProviderState | null> {
    this.maybeThrow(id);
    return this.transferStates.has(id) ? (this.transferStates.get(id) ?? null) : null;
  }
  async retrieveRefundState(id: string): Promise<ProviderState | null> {
    this.maybeThrow(id);
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

/** Module 87 — captures every `FailureReporter.report()` call so a test
 *  can assert a failure was surfaced (never silently swallowed) without
 *  having to inspect console/Sentry output. Mirrors
 *  `application/ports/failure-reporter.ts`'s own `NullFailureReporter`
 *  role, but records instead of discarding. */
export class FakeFailureReporter {
  reports: { error: unknown; context?: Record<string, unknown> }[] = [];

  report(error: unknown, context?: Record<string, unknown>): void {
    this.reports.push({ error, context });
  }
}

export function newDiscrepancyId(): string {
  return randomUUID();
}
