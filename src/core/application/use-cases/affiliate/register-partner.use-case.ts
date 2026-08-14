import { ConflictError } from "@/domain/errors/domain-error";
import type { CreatePartnerData, PartnerRecord, PartnerRepository } from "@/domain/repositories/partner-repository";
import { DEFAULT_MINIMUM_PAYOUT_THRESHOLD } from "@/domain/services/partner-payout-rules";

/**
 * Module 61 — Affiliate & Partner System: creates a new `Partner`
 * application, always in `PENDING` status — see
 * `domain/services/partner-approval-rules.ts` for the approval workflow an
 * admin drives from here. One partner account per `User` (enforced both
 * here, with a friendly `ConflictError`, and at the database level via
 * `Partner.userId`'s unique constraint — the same "check-then-create, but
 * also enforce it in the schema" convention `CreateReferralCodeUseCase`
 * already follows for `ReferralCode.code`).
 */
export class RegisterPartnerUseCase {
  constructor(private readonly partners: PartnerRepository) {}

  async execute(input: CreatePartnerData): Promise<PartnerRecord> {
    const existing = await this.partners.findByUserId(input.userId);
    if (existing) {
      throw new ConflictError(`User "${input.userId}" already has a partner account.`);
    }

    return this.partners.create({
      ...input,
      payoutMethod: input.payoutMethod ?? "MANUAL",
      payoutDetails: input.payoutDetails ?? null,
      minimumPayoutThreshold: input.minimumPayoutThreshold ?? DEFAULT_MINIMUM_PAYOUT_THRESHOLD,
    });
  }
}
