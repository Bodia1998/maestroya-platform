import { ConflictError, UnauthorizedError } from "@/domain/errors/domain-error";
import type { CompanyMembershipRepository } from "@/domain/repositories/company-membership-repository";
import type { CompanyVerificationRecord, CompanyVerificationRepository } from "@/domain/repositories/company-verification-repository";
import { canManageCompanyProfile } from "@/domain/services/company-membership-rules";
import { resolveCompanyActor } from "@/application/use-cases/company/resolve-company-actor";

/**
 * Module 18 — Company Professional: opens a fresh verification case (DRAFT)
 * for a company. Mirrors CreateProfessionalVerificationUseCase (Module 17):
 * only OWNER/ADMIN may start one; a company may hold at most one non-EXPIRED
 * case at a time (ConflictError otherwise), backed by the DB partial unique
 * index as the final concurrency guarantee.
 */
export class CreateCompanyVerificationUseCase {
  constructor(
    private readonly verifications: CompanyVerificationRepository,
    private readonly memberships: CompanyMembershipRepository,
  ) {}

  async execute(userId: string, companyId: string): Promise<CompanyVerificationRecord> {
    const actor = await resolveCompanyActor(userId, companyId, this.memberships);
    if (!canManageCompanyProfile(actor.role)) {
      throw new UnauthorizedError("Only a company owner or admin may request verification.");
    }

    const existing = await this.verifications.findActiveByCompanyProfileId(companyId);
    if (existing) {
      throw new ConflictError("This company already has an active verification request.");
    }

    return this.verifications.create(companyId);
  }
}
