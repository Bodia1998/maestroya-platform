import { DomainEvent } from "@/domain/events/domain-event";

/** Module 80 — Financial Reconciliation & Observability. Raised when an
 *  admin manually marks a discrepancy RESOLVED. There is no automatic
 *  resolution mechanism — see `ResolveDiscrepancyUseCase`'s own doc
 *  comment on why this is deliberate. */
export class DiscrepancyResolved extends DomainEvent {
  static readonly eventName = "reconciliation.discrepancy-resolved";
  constructor(
    readonly discrepancyId: string,
    readonly resolvedByUserId: string,
    readonly category: string,
    readonly severity: string,
  ) {
    super();
  }
}
