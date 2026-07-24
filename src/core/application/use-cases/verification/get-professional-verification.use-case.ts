import type { ProfessionalRepository } from "@/domain/repositories/professional-repository";
import type {
  ProfessionalVerificationRepository,
  ProfessionalVerificationWithDocuments,
} from "@/domain/repositories/professional-verification-repository";

export interface ProfessionalVerificationView {
  hasProfessionalProfile: boolean;
  verification: ProfessionalVerificationWithDocuments | null;
}

/**
 * Professional Verification module (Module 17): read the authenticated
 * professional's own current verification case (with its documents).
 * `userId` must come from the server-side session — the owning
 * ProfessionalProfile is always resolved by that userId, never a
 * client-supplied id, so a professional can only ever read their own case.
 *
 * Returns a lightweight view rather than throwing when there is no
 * professional profile / no case yet — the dashboard renders a "create your
 * professional profile first" / "not started" state from these flags.
 */
export class GetProfessionalVerificationUseCase {
  constructor(
    private readonly verifications: ProfessionalVerificationRepository,
    private readonly professionals: ProfessionalRepository,
  ) {}

  async execute(userId: string): Promise<ProfessionalVerificationView> {
    const professional = await this.professionals.findByUserId(userId);
    if (!professional) {
      return { hasProfessionalProfile: false, verification: null };
    }
    const verification = await this.verifications.findActiveWithDocumentsByProfessionalProfileId(professional.id);
    return { hasProfessionalProfile: true, verification };
  }
}
