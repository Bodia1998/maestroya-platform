import { NotFoundError } from "@/domain/errors/domain-error";
import type { AdminCompanyVerificationDetail, CompanyVerificationRepository } from "@/domain/repositories/company-verification-repository";

/** Module 18 — Company Professional: full admin detail view (documents,
 *  reasons, expiry). Mirrors GetAdminVerificationUseCase. */
export class GetAdminCompanyVerificationUseCase {
  constructor(private readonly verifications: CompanyVerificationRepository) {}

  async execute(verificationId: string): Promise<AdminCompanyVerificationDetail> {
    const detail = await this.verifications.getDetailForAdmin(verificationId);
    if (!detail) throw new NotFoundError("CompanyVerification", verificationId);
    return detail;
  }
}
