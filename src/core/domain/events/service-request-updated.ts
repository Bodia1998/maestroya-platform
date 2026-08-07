import { DomainEvent } from "@/domain/events/domain-event";

/**
 * Module 47 — CQRS Search Engine (Roadmap Module 14).
 *
 * Raised after a customer edits a published service request
 * (`UpdateServiceRequestUseCase`). Service requests are the
 * professional-facing half of discovery ("open jobs near me I could quote
 * on"), and the search read model is where that listing belongs — the
 * write model has no discovery repository for it (see
 * `docs/MODULE_47_CQRS_SEARCH_ENGINE.md`, "Index synchronization" for why
 * this kind is incrementally maintained but not bulk-rebuildable today).
 *
 * `status` is carried because it is the one field the *subscriber* itself
 * needs: a request that has left the open (PUBLISHED/QUOTED) states is
 * removed from the index rather than re-projected, and the subscriber can
 * decide that without a read. Every other field the document needs is
 * re-read from `ServiceRequestRepository` when the job runs, exactly like
 * the professional/company events.
 */
export class ServiceRequestUpdated extends DomainEvent {
  static readonly eventName = "service_request.updated";

  constructor(
    readonly serviceRequestId: string,
    /** `ServiceRequestStatusValue` at the time of the edit. */
    readonly status: string,
  ) {
    super();
  }
}
