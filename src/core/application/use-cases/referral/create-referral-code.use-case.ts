import { ConflictError } from "@/domain/errors/domain-error";
import { assertValidReferralCode } from "@/domain/services/referral-code-rules";
import type {
  CreateReferralCodeData,
  ReferralCodeRecord,
  ReferralCodeRepository,
} from "@/domain/repositories/referral-code-repository";

/**
 * Module 60 — Referral & Marketing Attribution Platform: administers a new
 * `ReferralCode`. Format validation lives in
 * `domain/services/referral-code-rules.ts`; uniqueness is enforced both
 * here (a friendly `ConflictError` before ever hitting the database) and
 * at the database level (a unique constraint on the `code` column — see
 * the migration), the same "check-then-create, but also enforce it in the
 * schema" convention `RegisterUserUseCase.execute` already follows for
 * `User.email`.
 */
export class CreateReferralCodeUseCase {
  constructor(private readonly codes: ReferralCodeRepository) {}

  async execute(input: CreateReferralCodeData): Promise<ReferralCodeRecord> {
    const code = assertValidReferralCode(input.code);

    const existing = await this.codes.findByCode(code);
    if (existing) {
      throw new ConflictError(`Referral code "${code}" is already in use.`);
    }

    return this.codes.create({
      code,
      ownerUserId: input.ownerUserId ?? null,
      label: input.label ?? null,
      source: input.source ?? null,
    });
  }
}
