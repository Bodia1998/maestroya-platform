import { DomainEvent } from "@/domain/events/domain-event";

/**
 * Module 145 — LEAD_V1 lead notifications.
 *
 * Raised by `PublishLeadUseCase` exactly when ITS call performed the
 * DRAFT -> PUBLISHED transition (the conditional write won) — never for an
 * idempotent repeat or a lost race, so one publication yields one event.
 *
 * Carries the lead id ONLY. Recipients and every displayed fact are re-read
 * server-side from the persisted Lead/ServiceRequest by the subscriber
 * (`LeadNotificationContextReader`); nothing in the payload is trusted for
 * identity, and no contact data can travel on it.
 */
export class LeadPublished extends DomainEvent {
  static readonly eventName = "lead.published";

  constructor(readonly leadId: string) {
    super();
  }
}
