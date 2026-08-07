import { NotFoundError, ValidationError } from "@/domain/errors/domain-error";
import { ProfessionalUpdated } from "@/domain/events/professional-updated";
import type { ProfessionalRecord, ProfessionalRepository } from "@/domain/repositories/professional-repository";
import type { ServiceCategoryRepository } from "@/domain/repositories/service-category-repository";
import type { UpdateProfessionalServicesInput } from "@/application/dto/professional.dto";
import type { EventBus } from "@/application/ports/event-bus";
import { NullEventBus } from "@/application/ports/null-event-bus";
import { publishDomainEvent } from "@/application/services/events/publish-domain-event";

/**
 * Replaces the *authenticated* user's own professional profile's set of
 * service categories. Looked up by session userId, never a client-
 * supplied professionalId. Every submitted category id is re-validated
 * against ServiceCategoryRepository — the client only sends ids, and an
 * id for a deleted/archived/nonexistent category must not be trusted.
 */
export class UpdateProfessionalServicesUseCase {
  constructor(
    private readonly professionals: ProfessionalRepository,
    private readonly categories: ServiceCategoryRepository,
    /** Module 47 — CQRS Search Engine: trailing/defaulted, see `CreateProfessionalUseCase`. */
    private readonly eventBus: EventBus = new NullEventBus(),
  ) {}

  async execute(userId: string, input: UpdateProfessionalServicesInput): Promise<ProfessionalRecord> {
    const existing = await this.professionals.findByUserId(userId);
    if (!existing) {
      throw new NotFoundError("ProfessionalProfile", userId);
    }

    const uniqueIds = [...new Set(input.categoryIds)];
    const found = await this.categories.findActiveByIds(uniqueIds);
    if (found.length !== uniqueIds.length) {
      throw new ValidationError("One or more selected service categories are invalid.");
    }

    const professional = await this.professionals.updateCategories(existing.id, uniqueIds);

    // Categories are an indexed, filterable field of the read model, so a
    // category change is as much a search change as a profile edit is.
    await publishDomainEvent(this.eventBus, new ProfessionalUpdated(existing.id, "categories"));

    return professional;
  }
}
