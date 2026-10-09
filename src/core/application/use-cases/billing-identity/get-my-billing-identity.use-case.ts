import { NotFoundError } from "@/domain/errors/domain-error";
import type { ProfessionalBillingIdentityRepository } from "@/domain/repositories/professional-billing-identity-repository";
import type { ProfessionalRepository } from "@/domain/repositories/professional-repository";
import { toProfessionalBillingIdentityView, type ProfessionalBillingIdentityView } from "@/application/dto/professional-billing-identity.dto";

/**
 * Module 146 — the signed-in professional reads THEIR OWN billing identity.
 * `userId` is the server-side session user; the profile is resolved from it and
 * no client-supplied profile/identity id exists. No billing identity yet = a
 * MISSING view (not an error).
 */
export class GetMyBillingIdentityUseCase {
  constructor(
    private readonly professionals: ProfessionalRepository,
    private readonly identities: ProfessionalBillingIdentityRepository,
  ) {}

  async execute(userId: string): Promise<ProfessionalBillingIdentityView> {
    const professional = await this.professionals.findByUserId(userId);
    if (!professional) throw new NotFoundError("ProfessionalProfile", userId);
    return toProfessionalBillingIdentityView(await this.identities.findByProfessionalProfileId(professional.id));
  }
}
