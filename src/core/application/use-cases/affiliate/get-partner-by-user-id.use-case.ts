import type { PartnerRecord, PartnerRepository } from "@/domain/repositories/partner-repository";

/**
 * Module 96 — Referral & Affiliate Production Wiring: the one-line
 * "resolve my own Partner account from my authenticated session's
 * userId" use case the partner dashboard page needs — mirrors
 * `GetProfessionalByUserIdUseCase`'s own role exactly (never trust a
 * client-supplied id; a profile/account is always looked up by the
 * authenticated session's own userId). Kept as its own tiny use case
 * (rather than a bare repository call from the page) for the same
 * "pages call use cases, never repositories directly" convention every
 * other dashboard page in this codebase follows.
 */
export class GetPartnerByUserIdUseCase {
  constructor(private readonly partners: PartnerRepository) {}

  async execute(userId: string): Promise<PartnerRecord | null> {
    return this.partners.findByUserId(userId);
  }
}
