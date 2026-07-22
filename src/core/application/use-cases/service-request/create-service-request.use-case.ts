import { ValidationError } from "@/domain/errors/domain-error";
import type { CustomerProfileRepository } from "@/domain/repositories/customer-profile-repository";
import type { ServiceRequestRecord, ServiceRequestRepository } from "@/domain/repositories/service-request-repository";
import type { ServiceCategoryRepository } from "@/domain/repositories/service-category-repository";
import type { CreateServiceRequestInput } from "@/application/dto/service-request.dto";

/**
 * Creates a ServiceRequest for the *authenticated* customer. `userId` must
 * come from the server-side session (see rbac.ts requireAuth()), never
 * from client input — ownership is always derived from the session, exactly
 * like CreateProfessionalUseCase does for ProfessionalProfile.
 *
 * A User doesn't need to have "signed up as a customer" separately — the
 * CustomerProfile behind them is resolved/created lazily here (see
 * CustomerProfileRepository), since requesting a service *is* what makes
 * someone a customer in this marketplace.
 *
 * Initial status is always PUBLISHED — this MVP has no separate
 * draft-save workflow (see service-request-state.ts for the full
 * OPEN/PUBLISHED reconciliation note).
 */
export class CreateServiceRequestUseCase {
  constructor(
    private readonly serviceRequests: ServiceRequestRepository,
    private readonly customerProfiles: CustomerProfileRepository,
    private readonly categories: ServiceCategoryRepository,
  ) {}

  async execute(userId: string, input: CreateServiceRequestInput): Promise<ServiceRequestRecord> {
    if (input.budgetMin !== undefined && input.budgetMax !== undefined && input.budgetMin > input.budgetMax) {
      throw new ValidationError("Minimum budget must not exceed maximum budget.");
    }

    const [category] = await this.categories.findActiveByIds([input.categoryId]);
    if (!category) {
      throw new ValidationError("Selected service category is invalid or inactive.");
    }

    const customer = await this.customerProfiles.findOrCreateByUserId(userId);

    return this.serviceRequests.create(customer.id, userId, {
      categoryId: category.id,
      title: input.title,
      description: input.description,
      urgency: input.urgency ?? "MEDIUM",
      budgetMin: input.budgetMin ?? null,
      budgetMax: input.budgetMax ?? null,
      location: {
        line1: input.location.line1,
        line2: input.location.line2 || null,
        city: input.location.city,
        province: input.location.province || null,
        postalCode: input.location.postalCode,
        country: input.location.country,
        latitude: input.location.latitude ?? null,
        longitude: input.location.longitude ?? null,
      },
    });
  }
}
