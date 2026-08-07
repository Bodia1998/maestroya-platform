import { DomainEvent } from "@/domain/events/domain-event";

/**
 * Module 47 — CQRS Search Engine (Roadmap Module 14).
 *
 * Raised whenever anything about a professional that search cares about
 * changed — profile fields (`UpdateProfessionalUseCase`), the service
 * categories they work in (`UpdateProfessionalServicesUseCase`), or their
 * availability for discovery at all (`DeactivateProfessionalUseCase`).
 *
 * One event rather than three (`ProfessionalProfileEdited`,
 * `ProfessionalCategoriesChanged`, `ProfessionalDeactivated`) because the
 * read model's reaction to all three is identical: re-project this
 * professional from the write model. `IndexSearchDocumentUseCase` handles
 * the deactivation case without a distinct event, because it re-reads
 * eligibility from `ProfessionalDiscoveryRepository` — a professional who
 * is no longer an ACTIVE discovery candidate is *removed* from the index
 * rather than re-indexed. That keeps "is this entity searchable?" a single
 * rule, owned by the discovery repository, instead of a rule the event
 * publisher would have to re-derive and could get wrong.
 *
 * `reason` is a short, non-authoritative label (`"profile"`,
 * `"categories"`, `"status"`) carried for observability only — logs and
 * the index job's diagnostics. Nothing branches on it.
 */
export class ProfessionalUpdated extends DomainEvent {
  static readonly eventName = "professional.updated";

  constructor(
    /** ProfessionalProfile.id — never a User.id. */
    readonly professionalId: string,
    readonly reason: "profile" | "categories" | "status" = "profile",
  ) {
    super();
  }
}
