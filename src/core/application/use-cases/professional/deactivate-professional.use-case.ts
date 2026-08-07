import { NotFoundError, ValidationError } from "@/domain/errors/domain-error";
import { ProfessionalUpdated } from "@/domain/events/professional-updated";
import type { ProfessionalRepository } from "@/domain/repositories/professional-repository";
import type { EventBus } from "@/application/ports/event-bus";
import { NullEventBus } from "@/application/ports/null-event-bus";
import { publishDomainEvent } from "@/application/services/events/publish-domain-event";

/**
 * Deactivates the *authenticated* user's own professional profile
 * (status -> INACTIVE). Looked up by session userId, never by a
 * client-supplied professionalId. Deactivating is idempotent-ish but an
 * already-deactivated profile is surfaced as a validation error rather
 * than silently succeeding, so the UI can give clear feedback instead of
 * a misleading "success".
 */
export class DeactivateProfessionalUseCase {
  constructor(
    private readonly professionals: ProfessionalRepository,
    /** Module 47 — CQRS Search Engine: trailing/defaulted, see `CreateProfessionalUseCase`. */
    private readonly eventBus: EventBus = new NullEventBus(),
  ) {}

  async execute(userId: string): Promise<void> {
    const existing = await this.professionals.findByUserId(userId);
    if (!existing) {
      throw new NotFoundError("ProfessionalProfile", userId);
    }
    if (existing.status === "INACTIVE") {
      throw new ValidationError("This professional profile is already deactivated.");
    }

    await this.professionals.updateStatus(existing.id, "INACTIVE");

    // Deactivation needs no dedicated "removed from search" event: the
    // indexing job re-reads eligibility from the discovery repository,
    // which no longer returns an INACTIVE profile, and therefore deletes
    // the document instead of refreshing it (see
    // `SearchDocumentProjector`).
    await publishDomainEvent(this.eventBus, new ProfessionalUpdated(existing.id, "status"));
  }
}
