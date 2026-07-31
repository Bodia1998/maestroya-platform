import { ValidationError } from "@/domain/errors/domain-error";
import type { CustomerProfileRepository } from "@/domain/repositories/customer-profile-repository";
import type { GeocodingProvider } from "@/domain/repositories/geocoding-provider";
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
 *
 * Coordinates: the request form only exposes `latitude`/`longitude` as
 * optional raw-number fields (see service-request-form.tsx) — in practice
 * a customer almost never fills those in, so relying on them alone left
 * nearly every request with null coordinates. `isProfessionalEligibleForRequest`
 * (see quote-eligibility.ts) requires both sides to have coordinates, so a
 * PUBLISHED request with no lat/long can never appear in a professional's
 * Available Requests regardless of city match or service radius — that was
 * the actual root cause of requests silently going undiscovered. Fixed the
 * same way `CompleteProfessionalOnboardingUseCase` already resolves a
 * professional's own base location: an explicit client-supplied coordinate
 * always wins (never overridden), otherwise fall back to geocoding the
 * entered city/province via the existing `GeocodingProvider`. A city the
 * provider doesn't recognize still resolves to `null` — request creation
 * itself must never fail because of this, it only degrades discoverability
 * for that one request, exactly like onboarding's own documented fallback.
 */
export class CreateServiceRequestUseCase {
  constructor(
    private readonly serviceRequests: ServiceRequestRepository,
    private readonly customerProfiles: CustomerProfileRepository,
    private readonly categories: ServiceCategoryRepository,
    private readonly geocoding: GeocodingProvider,
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

    let latitude = input.location.latitude ?? null;
    let longitude = input.location.longitude ?? null;
    if (latitude === null || longitude === null) {
      const point = await this.geocoding.geocode({
        city: input.location.city,
        province: input.location.province || undefined,
        country: input.location.country || undefined,
      });
      latitude = latitude ?? point?.latitude ?? null;
      longitude = longitude ?? point?.longitude ?? null;
    }

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
        latitude,
        longitude,
      },
    });
  }
}
