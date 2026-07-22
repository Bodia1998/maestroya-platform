import { NotFoundError } from "@/domain/errors/domain-error";
import type { ProfessionalRecord, ProfessionalRepository } from "@/domain/repositories/professional-repository";

/**
 * Fetches a professional profile by its own id. This is intentionally a
 * plain lookup with no ownership check baked in — it exists to support a
 * future public/marketplace view of a professional's profile (by anyone),
 * separate from "view *my* profile" (see GetProfessionalByUserIdUseCase,
 * which the dashboard uses and which never trusts a client-supplied id).
 */
export class GetProfessionalUseCase {
  constructor(private readonly professionals: ProfessionalRepository) {}

  async execute(professionalId: string): Promise<ProfessionalRecord> {
    const professional = await this.professionals.findById(professionalId);
    if (!professional) {
      throw new NotFoundError("ProfessionalProfile", professionalId);
    }
    return professional;
  }
}
