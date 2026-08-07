import { ConflictError, ValidationError } from "@/domain/errors/domain-error";
import { ProfessionalCreated } from "@/domain/events/professional-created";
import type { ProfessionalRecord, ProfessionalRepository } from "@/domain/repositories/professional-repository";
import type { ServiceCategoryRepository } from "@/domain/repositories/service-category-repository";
import type { CreateProfessionalInput } from "@/application/dto/professional.dto";
import type { EventBus } from "@/application/ports/event-bus";
import { NullEventBus } from "@/application/ports/null-event-bus";
import { publishDomainEvent } from "@/application/services/events/publish-domain-event";

/**
 * Creates the ProfessionalProfile for the *authenticated* user — `userId`
 * must come from the server-side session (see rbac.ts requireAuth()),
 * never from client input, since this is what ties the new profile to a
 * specific account. One profile per user (ProfessionalProfile.userId is
 * unique in schema.prisma), so an existing profile is a conflict, not
 * something to silently overwrite.
 */
export class CreateProfessionalUseCase {
  constructor(
    private readonly professionals: ProfessionalRepository,
    private readonly categories: ServiceCategoryRepository,
    /**
     * Module 47 — CQRS Search Engine: added as a *trailing, defaulted*
     * parameter so every pre-existing call site and test keeps compiling
     * and behaving identically (the null bus publishes into a void). The
     * real composition root injects the shared `eventBus`.
     */
    private readonly eventBus: EventBus = new NullEventBus(),
  ) {}

  async execute(userId: string, input: CreateProfessionalInput): Promise<ProfessionalRecord> {
    const existing = await this.professionals.findByUserId(userId);
    if (existing) {
      throw new ConflictError("A professional profile already exists for this account.");
    }

    const categoryIds = await this.validateCategoryIds(input.categoryIds);

    const professional = await this.professionals.create(userId, {
      businessName: input.businessName || null,
      headline: input.headline || null,
      bio: input.bio || null,
      yearsExperience: input.yearsExperience ?? null,
      serviceRadiusKm: input.serviceRadiusKm ?? null,
      contactEmail: input.contactEmail || null,
      contactPhone: input.contactPhone || null,
      websiteUrl: input.websiteUrl || null,
      taxId: input.taxId || null,
      categoryIds,
    });

    // Module 47 — CQRS Search Engine: announced only after the write has
    // succeeded, so the search read model can never learn about a
    // professional that does not exist. Publishing cannot fail this use
    // case (see `publishDomainEvent`), and the subscriber only enqueues a
    // background job — no indexing happens on this request's path.
    await publishDomainEvent(this.eventBus, new ProfessionalCreated(professional.id, userId));

    return professional;
  }

  private async validateCategoryIds(categoryIds: string[] | undefined): Promise<string[]> {
    if (!categoryIds || categoryIds.length === 0) return [];
    const found = await this.categories.findActiveByIds(categoryIds);
    if (found.length !== new Set(categoryIds).size) {
      throw new ValidationError("One or more selected service categories are invalid.");
    }
    return categoryIds;
  }
}
