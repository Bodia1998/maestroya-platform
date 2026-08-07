import { DomainEvent } from "@/domain/events/domain-event";

/**
 * Module 47 — CQRS Search Engine (Roadmap Module 14).
 *
 * Raised whenever a company's own searchable data changed — profile
 * fields (`UpdateCompanyUseCase`) or the service categories it operates
 * in (`UpdateCompanyServicesUseCase`). The company-side mirror of
 * `ProfessionalUpdated`; see that event's doc comment for why one event
 * covers several distinct edits, and why removal-on-ineligibility needs
 * no separate event.
 *
 * Note the deliberate overlap with the pre-existing
 * `CompanyStatusChanged`/`CompanyVerificationStatusChanged` events: the
 * search module subscribes to *those* too (they change `isVerified` and
 * discovery eligibility, both indexed fields), so this event exists only
 * to cover the plain-edit case none of them announce. Two events landing
 * for one logical change is harmless — both enqueue the same
 * "re-project this company" job, and re-projection is idempotent.
 */
export class CompanyUpdated extends DomainEvent {
  static readonly eventName = "company.updated";

  constructor(
    /** CompanyProfile.id. */
    readonly companyId: string,
    readonly reason: "profile" | "categories" | "status" = "profile",
  ) {
    super();
  }
}
