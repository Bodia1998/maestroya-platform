import { NotFoundError, ValidationError } from "@/domain/errors/domain-error";
import type {
  ProfessionalOnboardingRepository,
  ProfessionalPayoutAccountRecord,
} from "@/domain/repositories/professional-onboarding-repository";
import type {
  CompanyPayoutAccountRecord,
  CompanyPayoutAccountRepository,
} from "@/domain/repositories/company-payout-account-repository";
import { isPayoutAccountConnected } from "@/domain/services/professional-onboarding-rules";

/**
 * Module 75 — Company Payout Eligibility.
 *
 * `Payout.professionalProfileId`/`Payout.companyProfileId` (see that
 * model's own doc comment in schema.prisma) already tell a caller WHICH
 * owner a payout belongs to — this use case is the one place that
 * resolves that owner id into the actual destination row money would be
 * sent to: `ProfessionalPayoutAccount` for a `professionalProfileId`,
 * `CompanyPayoutAccount` for a `companyProfileId`. Never executes a
 * transfer itself (that is Module 76's job) — this is read-only
 * resolution, the exact seam a future Module 76 is expected to call
 * before ever initiating a real Stripe transfer, the same role
 * `CheckPayoutReadinessUseCase` already plays for the "is this job's
 * payment ready" question.
 *
 * Cross-owner access is structurally impossible here, not just checked:
 * each lookup is keyed by the caller-supplied owner id against a table
 * that is unique-per-owner (`professionalProfileId`/`companyProfileId`
 * are each `@unique`) — there is no shared/global lookup key a caller
 * could pass the wrong owner's id into and still get back someone else's
 * account. Passing a company's id as `professionalProfileId` (or vice
 * versa) simply resolves nothing (`NotFoundError`), never another
 * owner's real destination.
 */
export type PayoutDestinationOwner =
  | { type: "PROFESSIONAL"; professionalProfileId: string }
  | { type: "COMPANY"; companyProfileId: string };

export type ResolvedPayoutDestination =
  | { ownerType: "PROFESSIONAL"; ownerId: string; account: ProfessionalPayoutAccountRecord }
  | { ownerType: "COMPANY"; ownerId: string; account: CompanyPayoutAccountRecord };

export class ResolvePayoutDestinationUseCase {
  constructor(
    private readonly professionalOnboardings: ProfessionalOnboardingRepository,
    private readonly companyPayoutAccounts: CompanyPayoutAccountRepository,
  ) {}

  /**
   * @param requireConnected When `true` (the default), a destination that
   *   exists but is `REJECTED` (or has never been connected at all) is
   *   rejected with `ValidationError` rather than returned — the "inactive
   *   destination" case the module brief asks this resolution step to
   *   reject. Pass `false` only for read-only display purposes that need
   *   to show a rejected/missing destination to its own owner (never for
   *   anything that feeds a payout decision).
   */
  async execute(owner: PayoutDestinationOwner, requireConnected = true): Promise<ResolvedPayoutDestination> {
    if (owner.type === "PROFESSIONAL") {
      const account = await this.professionalOnboardings.findPayoutAccountByProfessionalProfileId(
        owner.professionalProfileId,
      );
      if (!account) {
        throw new NotFoundError("ProfessionalPayoutAccount", owner.professionalProfileId);
      }
      if (requireConnected && !isPayoutAccountConnected(account.status)) {
        throw new ValidationError(`This professional's payout destination is not usable (status: ${account.status}).`);
      }
      return { ownerType: "PROFESSIONAL", ownerId: owner.professionalProfileId, account };
    }

    const account = await this.companyPayoutAccounts.findByCompanyProfileId(owner.companyProfileId);
    if (!account) {
      throw new NotFoundError("CompanyPayoutAccount", owner.companyProfileId);
    }
    if (requireConnected && !isPayoutAccountConnected(account.status)) {
      throw new ValidationError(`This company's payout destination is not usable (status: ${account.status}).`);
    }
    return { ownerType: "COMPANY", ownerId: owner.companyProfileId, account };
  }
}
