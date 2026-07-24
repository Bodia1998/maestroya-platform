import { UnauthorizedError } from "@/domain/errors/domain-error";
import type { CompanyMembershipRepository } from "@/domain/repositories/company-membership-repository";
import type { CompanyVerificationWithDocuments, CompanyVerificationRepository } from "@/domain/repositories/company-verification-repository";
import { canManageCompanyProfile } from "@/domain/services/company-membership-rules";
import { resolveCompanyActor } from "@/application/use-cases/company/resolve-company-actor";

/** Module 18 — Company Professional: the company's own current verification
 *  case + documents, for its dashboard view. OWNER/ADMIN only — MANAGER/
 *  MEMBER cannot see verification documents (private/business-sensitive). */
export class GetCompanyVerificationUseCase {
  constructor(
    private readonly verifications: CompanyVerificationRepository,
    private readonly memberships: CompanyMembershipRepository,
  ) {}

  async execute(userId: string, companyId: string): Promise<CompanyVerificationWithDocuments | null> {
    const actor = await resolveCompanyActor(userId, companyId, this.memberships);
    if (!canManageCompanyProfile(actor.role)) {
      throw new UnauthorizedError("Only a company owner or admin may view verification details.");
    }
    return this.verifications.findActiveWithDocumentsByCompanyProfileId(companyId);
  }
}
