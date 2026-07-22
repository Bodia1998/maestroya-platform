import { NotFoundError } from "@/domain/errors/domain-error";
import type { ProfessionalRecord, ProfessionalRepository } from "@/domain/repositories/professional-repository";
import type { UpdateProfessionalInput } from "@/application/dto/professional.dto";

/**
 * Updates the *authenticated* user's own professional profile. `userId`
 * must come from the server-side session — the profile to update is
 * looked up by that userId, never by a professionalId supplied by the
 * client, so a professional can never update someone else's profile by
 * passing a different id. `status` and `verificationStatus` are
 * deliberately not accepted here — see UpdateProfessionalInput and
 * DeactivateProfessionalUseCase.
 */
export class UpdateProfessionalUseCase {
  constructor(private readonly professionals: ProfessionalRepository) {}

  async execute(userId: string, input: UpdateProfessionalInput): Promise<ProfessionalRecord> {
    const existing = await this.professionals.findByUserId(userId);
    if (!existing) {
      throw new NotFoundError("ProfessionalProfile", userId);
    }

    return this.professionals.update(existing.id, {
      businessName: input.businessName || null,
      headline: input.headline || null,
      bio: input.bio || null,
      yearsExperience: input.yearsExperience ?? null,
      hourlyRate: input.hourlyRate ?? null,
      serviceRadiusKm: input.serviceRadiusKm ?? null,
      contactEmail: input.contactEmail || null,
      contactPhone: input.contactPhone || null,
      websiteUrl: input.websiteUrl || null,
      taxId: input.taxId || null,
      isAcceptingRequests: input.isAcceptingRequests,
    });
  }
}
