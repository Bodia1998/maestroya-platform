import { NotFoundError } from "@/domain/errors/domain-error";
import type { AdminAuditLogRepository } from "@/domain/repositories/admin-audit-log-repository";
import type { ProfessionalBillingIdentityRepository } from "@/domain/repositories/professional-billing-identity-repository";
import type { ProfessionalRepository } from "@/domain/repositories/professional-repository";
import { assertValidBillingIdentityDetails } from "@/domain/services/professional-billing-identity";
import { toProfessionalBillingIdentityView, type ProfessionalBillingIdentityView, type SaveBillingIdentityInput } from "@/application/dto/professional-billing-identity.dto";
import { type FailureReporter, NullFailureReporter } from "@/application/ports/failure-reporter";

/**
 * Module 146 — the signed-in professional creates or updates THEIR OWN billing
 * details.
 *
 * Authority: this use case has no status parameter and the repository's
 * `saveDetails` cannot set one. Saving complete details yields UNVERIFIED
 * ("pending review"); saving a material change to an already reviewed identity
 * resets it to UNVERIFIED and clears the review (database trigger as backstop);
 * saving identical details is a no-op that keeps the current status.
 * Verification only ever comes from Verify/RejectBillingIdentityUseCase.
 *
 * Validation here is syntax + completeness (domain policy, re-applied even if the
 * caller skipped the DTO schema). It does not assert legal validity of the tax id.
 * It does not touch ProfessionalProfile.taxId/businessName, the M98 verification
 * case, payments or purchases. The audit entry carries ids/flags only — never
 * a tax id or address.
 */
export class SaveMyBillingIdentityUseCase {
  constructor(
    private readonly professionals: ProfessionalRepository,
    private readonly identities: ProfessionalBillingIdentityRepository,
    private readonly audit?: AdminAuditLogRepository,
    private readonly failureReporter: FailureReporter = new NullFailureReporter(),
  ) {}

  async execute(userId: string, input: SaveBillingIdentityInput): Promise<ProfessionalBillingIdentityView> {
    const professional = await this.professionals.findByUserId(userId);
    if (!professional) throw new NotFoundError("ProfessionalProfile", userId);

    const details = assertValidBillingIdentityDetails(input as unknown as Record<string, unknown>);
    const { record, changed } = await this.identities.saveDetails(professional.id, details);

    if (changed && this.audit) {
      try {
        await this.audit.record({
          adminUserId: userId,
          action: "BILLING_IDENTITY_SUBMITTED",
          targetType: "ProfessionalBillingIdentity",
          targetId: record.id,
          metadata: { professionalProfileId: professional.id, revision: record.revision },
        });
      } catch (error) {
        this.failureReporter.report(error, { useCase: "SaveMyBillingIdentityUseCase", identityId: record.id });
      }
    }

    return toProfessionalBillingIdentityView(record);
  }
}
