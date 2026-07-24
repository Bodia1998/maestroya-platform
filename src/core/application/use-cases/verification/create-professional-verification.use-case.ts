import { ConflictError, ValidationError } from "@/domain/errors/domain-error";
import type { ProfessionalRepository } from "@/domain/repositories/professional-repository";
import type {
  ProfessionalVerificationRecord,
  ProfessionalVerificationRepository,
} from "@/domain/repositories/professional-verification-repository";

/**
 * Professional Verification module (Module 17): opens a fresh verification
 * case (DRAFT) for the authenticated professional. `userId` is always
 * resolved from the session; the professional must have an ACTIVE profile
 * (same rule as CreatePortfolioItemUseCase — a suspended/inactive
 * professional, or a non-professional with no profile at all, is rejected).
 *
 * A professional may hold at most one non-EXPIRED case at a time — if they
 * already have an active one (including an APPROVED one that has not yet
 * expired), this throws ConflictError rather than silently opening a second.
 * This is the application-level half of the invariant the partial unique
 * index enforces at the database level.
 *
 * Opening a DRAFT is not itself an audited event (auditing begins at
 * submission — see SubmitProfessionalVerificationUseCase).
 */
export class CreateProfessionalVerificationUseCase {
  constructor(
    private readonly verifications: ProfessionalVerificationRepository,
    private readonly professionals: ProfessionalRepository,
  ) {}

  async execute(userId: string): Promise<ProfessionalVerificationRecord> {
    const professional = await this.professionals.findByUserId(userId);
    if (!professional || professional.status !== "ACTIVE") {
      throw new ValidationError("You must have an active professional profile to request verification.");
    }

    const existing = await this.verifications.findActiveByProfessionalProfileId(professional.id);
    if (existing) {
      throw new ConflictError("You already have an active verification request.");
    }

    return this.verifications.create(professional.id);
  }
}
