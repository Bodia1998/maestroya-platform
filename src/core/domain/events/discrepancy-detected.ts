import { DomainEvent } from "@/domain/events/domain-event";

/** Module 80 — Financial Reconciliation & Observability. Raised only when
 *  a NEW discrepancy row is inserted (`created === true` from
 *  `ReconciliationDiscrepancyRepository.createOrTouch`) — a re-detected,
 *  already-OPEN discrepancy on a later run does not re-fire this event,
 *  avoiding repeated alert noise for a persistently unresolved issue. */
export class DiscrepancyDetected extends DomainEvent {
  static readonly eventName = "reconciliation.discrepancy-detected";
  constructor(
    readonly discrepancyId: string,
    readonly runId: string,
    readonly category: string,
    readonly severity: string,
    readonly entityType: string,
    readonly entityId: string | null,
    readonly jobId: string | null,
  ) {
    super();
  }
}
