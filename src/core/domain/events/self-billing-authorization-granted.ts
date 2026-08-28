import { DomainEvent } from "@/domain/events/domain-event";

/**
 * Module 79 — Invoicing & Credit Notes. Raised by
 * `GrantSelfBillingAuthorizationUseCase` the moment a professional/company
 * electronically accepts MaestroYa's self-billing agreement. Auditable
 * signal for onboarding/compliance subscribers — never itself a legal
 * attestation (see the module brief's "IMPORTANT LEGAL/ACCOUNTING
 * LIMITATION" section).
 */
export class SelfBillingAuthorizationGranted extends DomainEvent {
  static readonly eventName = "invoicing.self-billing-authorization-granted";

  constructor(
    readonly authorizationId: string,
    readonly professionalProfileId: string | null,
    readonly companyProfileId: string | null,
    readonly agreementVersion: string,
    readonly acceptedByUserId: string,
  ) {
    super();
  }
}
