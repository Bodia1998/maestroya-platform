import { DomainEvent } from "@/domain/events/domain-event";

/** Module 80 — Financial Reconciliation & Observability. Raised only when
 *  the reconciliation engine itself throws before completing — never for
 *  a run that completes and simply finds discrepancies (that is success,
 *  not failure). */
export class ReconciliationRunFailed extends DomainEvent {
  static readonly eventName = "reconciliation.run-failed";
  constructor(
    readonly runId: string,
    readonly scope: string,
    readonly errorMessage: string,
    readonly recordsInspected: number,
  ) {
    super();
  }
}
