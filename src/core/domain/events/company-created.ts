import { DomainEvent } from "@/domain/events/domain-event";

/**
 * Module 47 — CQRS Search Engine (Roadmap Module 14).
 *
 * Raised once a `CompanyProfile` (and its seed OWNER membership) has been
 * successfully persisted — see `CreateCompanyUseCase`. The company-side
 * mirror of `ProfessionalCreated`, with the same id-only payload for the
 * same reason (see that event's own doc comment): the indexing job
 * re-reads the company from `CompanyDiscoveryRepository` rather than
 * trusting a snapshot taken at publish time.
 *
 * Deliberately distinct from the pre-existing `CompanyStatusChanged` /
 * `CompanyVerificationStatusChanged` events, which announce *moderation*
 * transitions on an already-existing company; neither of them ever fires
 * for a brand-new one, which is why search had no way to learn about
 * company creation before this module.
 */
export class CompanyCreated extends DomainEvent {
  static readonly eventName = "company.created";

  constructor(
    /** CompanyProfile.id. */
    readonly companyId: string,
    /** The owning user (CompanyProfile.ownerUserId) — carried for audit-style subscribers. */
    readonly ownerUserId: string,
  ) {
    super();
  }
}
