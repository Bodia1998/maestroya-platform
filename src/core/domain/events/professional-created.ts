import { DomainEvent } from "@/domain/events/domain-event";

/**
 * Module 47 — CQRS Search Engine (Roadmap Module 14).
 *
 * Raised once a `ProfessionalProfile` has been successfully persisted
 * (see `CreateProfessionalUseCase`). The first of the five entity
 * lifecycle events this module had to add — the codebase already had
 * review/dispute/verification/status events, but nothing announced the
 * creation or editing of the two entities customer-facing search is
 * actually *about*.
 *
 * The payload is deliberately just the identifier, not a snapshot of the
 * profile. A search-index job re-reads the entity from the write model
 * (`ProfessionalDiscoveryRepository`) when it runs, so:
 *
 *  - the event stays valid however the profile shape evolves;
 *  - a job retried minutes later indexes the *current* row, not a stale
 *    copy captured at publish time;
 *  - two events for the same entity collapse into the same work, which
 *    is what makes the indexing pipeline idempotent end to end.
 *
 * `userId` is carried alongside purely because every other event in this
 * codebase carries the acting/owning user for audit-style subscribers;
 * the indexing subscriber ignores it.
 */
export class ProfessionalCreated extends DomainEvent {
  static readonly eventName = "professional.created";

  constructor(
    /** ProfessionalProfile.id — never a User.id. */
    readonly professionalId: string,
    readonly userId: string,
  ) {
    super();
  }
}
