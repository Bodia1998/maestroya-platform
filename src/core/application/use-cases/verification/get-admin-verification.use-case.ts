import { NotFoundError } from "@/domain/errors/domain-error";
import type {
  AdminVerificationDetail,
  ProfessionalVerificationRepository,
} from "@/domain/repositories/professional-verification-repository";

/**
 * Professional Verification module (Module 17): full case detail for a
 * reviewer, including the professional's identity and the case's documents
 * (with their secure URLs — only ever reachable through the ADMIN/
 * SUPER_ADMIN-guarded Server Action). Throws NotFoundError if the case does
 * not exist.
 */
export class GetAdminVerificationUseCase {
  constructor(private readonly verifications: ProfessionalVerificationRepository) {}

  async execute(verificationId: string): Promise<AdminVerificationDetail> {
    const detail = await this.verifications.getDetailForAdmin(verificationId);
    if (!detail) {
      throw new NotFoundError("ProfessionalVerification", verificationId);
    }
    return detail;
  }
}
