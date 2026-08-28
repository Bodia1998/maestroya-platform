import { DomainEvent } from "@/domain/events/domain-event";

/** Module 80 — Financial Reconciliation & Observability. Raised once a
 *  run finishes evaluating every enabled check, regardless of whether any
 *  discrepancy was found. */
export class ReconciliationRunCompleted extends DomainEvent {
  static readonly eventName = "reconciliation.run-completed";
  constructor(
    readonly runId: string,
    readonly scope: string,
    readonly recordsInspected: number,
    readonly discrepancyCount: number,
    readonly durationMs: number,
  ) {
    super();
  }
}
