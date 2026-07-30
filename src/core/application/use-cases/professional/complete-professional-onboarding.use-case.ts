import type { AddressRepository } from "@/domain/repositories/address-repository";
import type { GeocodingProvider } from "@/domain/repositories/geocoding-provider";
import type { ProfessionalRecord } from "@/domain/repositories/professional-repository";
import type { UserRepository } from "@/domain/repositories/user-repository";
import type { ProfessionalOnboardingInput } from "@/application/dto/professional.dto";
import type { CreateProfessionalUseCase } from "@/application/use-cases/professional/create-professional.use-case";

/**
 * Professional Onboarding — the single orchestration point for "a user who
 * registered via 'Soy profesional' finishes setting up their professional
 * account." Deliberately composes existing use cases/repositories rather
 * than reimplementing any of their behavior:
 *
 *   1. Resolves the entered base-location city to a coordinate via the
 *      existing `GeocodingProvider` (Module 20's own documented "ready
 *      but not wired into any profile-editing flow" seam — this is that
 *      wiring) and persists it through the existing
 *      `AddressRepository.upsertPrimaryForUser` — the same "base
 *      location" mechanism the Profile module's own address form already
 *      uses, not a new free-text "service area" field. A city the static
 *      provider doesn't recognize resolves to `null` coordinates rather
 *      than failing onboarding — search/matching degrades gracefully
 *      (falls back to `serviceRadiusKm` alone), it never blocks account
 *      setup.
 *   2. Delegates profile creation entirely to the existing
 *      `CreateProfessionalUseCase` — this is what already, atomically,
 *      grants the PROVIDER role (see PrismaProfessionalRepository.create).
 *      Nothing here duplicates that.
 *   3. Clears `signupIntent` now that onboarding is complete — from this
 *      point on, PROVIDER role membership alone is the source of truth
 *      for "is this user a professional" (see middleware.ts).
 *
 * Order matters: the address is saved *before* `CreateProfessionalUseCase`
 * runs, so if category validation fails (e.g. a stale/invalid
 * `categoryIds`) the user's address entry isn't lost — resubmitting the
 * form just re-upserts the same address and retries profile creation.
 */
export class CompleteProfessionalOnboardingUseCase {
  constructor(
    private readonly users: UserRepository,
    private readonly addresses: AddressRepository,
    private readonly geocoding: GeocodingProvider,
    private readonly createProfessional: CreateProfessionalUseCase,
  ) {}

  async execute(userId: string, input: ProfessionalOnboardingInput): Promise<ProfessionalRecord> {
    const point = await this.geocoding.geocode({
      city: input.address.city,
      province: input.address.province || undefined,
    });

    await this.addresses.upsertPrimaryForUser(userId, {
      line1: input.address.line1,
      line2: input.address.line2 || null,
      city: input.address.city,
      province: input.address.province || null,
      postalCode: input.address.postalCode,
      country: input.address.country,
      latitude: point?.latitude ?? null,
      longitude: point?.longitude ?? null,
    });

    const professional = await this.createProfessional.execute(userId, {
      contactPhone: input.contactPhone,
      bio: input.bio,
      serviceRadiusKm: input.serviceRadiusKm,
      categoryIds: input.categoryIds,
    });

    await this.users.clearSignupIntent(userId);

    return professional;
  }
}
