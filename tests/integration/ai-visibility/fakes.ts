import type {
  AiVisibilityObservationRecord,
  AiVisibilityObservationRepository,
  ListAiVisibilityObservationsOptions,
  RecordAiVisibilityObservationData,
} from "@/domain/repositories/ai-visibility-observation-repository";

/**
 * Module 119 — AI Recommendation Monitoring: in-memory test double, same
 * pattern as `tests/integration/admin/fakes.ts`'s
 * `InMemoryAdminAuditLogRepository` — implements the real interface so
 * use cases under test run their genuine orchestration/validation logic.
 * `record()` always appends a new row (never mutates or removes an
 * existing one) — mirroring the real Prisma repository's append-only
 * contract exactly, so a test relying on history preservation exercises
 * the same guarantee production gets.
 */
export class InMemoryAiVisibilityObservationRepository implements AiVisibilityObservationRepository {
  private rows: AiVisibilityObservationRecord[] = [];
  private idCounter = 0;

  async record(data: RecordAiVisibilityObservationData): Promise<AiVisibilityObservationRecord> {
    this.idCounter += 1;
    const row: AiVisibilityObservationRecord = {
      ...data,
      id: `obs-${this.idCounter}`,
      createdAt: new Date(),
    };
    this.rows.push(row);
    return row;
  }

  async list(options: ListAiVisibilityObservationsOptions): Promise<AiVisibilityObservationRecord[]> {
    let rows = [...this.rows];
    if (options.queryId) rows = rows.filter((r) => r.queryId === options.queryId);
    if (options.provider) rows = rows.filter((r) => r.provider === options.provider);
    if (options.observedFrom) rows = rows.filter((r) => r.observedAt >= options.observedFrom!);
    if (options.observedTo) rows = rows.filter((r) => r.observedAt <= options.observedTo!);
    rows.sort((a, b) => b.observedAt.getTime() - a.observedAt.getTime());
    return rows.slice(options.offset, options.offset + options.limit);
  }

  async listForPeriod(period: { from: Date | null; to: Date | null }): Promise<AiVisibilityObservationRecord[]> {
    return this.rows
      .filter((r) => (period.from ? r.observedAt >= period.from : true) && (period.to ? r.observedAt <= period.to : true))
      .sort((a, b) => b.observedAt.getTime() - a.observedAt.getTime());
  }

  /** Test-only helper: total rows ever recorded, ignoring every filter —
   *  used to assert history is never overwritten/removed. */
  allRows(): AiVisibilityObservationRecord[] {
    return [...this.rows];
  }
}
