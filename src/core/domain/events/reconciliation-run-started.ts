import { DomainEvent } from "@/domain/events/domain-event";

/** Module 80 — Financial Reconciliation & Observability. Raised the
 *  instant a ReconciliationRun row is created (status RUNNING). */
export class ReconciliationRunStarted extends DomainEvent {
  static readonly eventName = "reconciliation.run-started";
  constructor(
    readonly runId: string,
    readonly scope: string,
    readonly triggeredByUserId: string | null,
  ) {
    super();
  }
}
