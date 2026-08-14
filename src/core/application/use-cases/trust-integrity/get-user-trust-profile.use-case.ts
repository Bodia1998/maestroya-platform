import type { TrustProfileRepository, TrustProfileRecord } from "@/domain/repositories/trust-profile-repository";
import { TrustProfileNotFoundError } from "@/domain/errors/domain-error";

/**
 * Module 65 — Trust & Integrity System: read-only lookup for a user's
 * current Trust/Risk Score, used by future modules that need to gate on
 * it (e.g. "only show this professional in search if riskScore < X").
 * Deliberately does NOT lazily create a profile (unlike
 * `RecordUserBehaviorSignalUseCase`) — a pure read should never have the
 * side effect of writing a row; see `TrustProfileNotFoundError`'s own doc
 * comment.
 */
export class GetUserTrustProfileUseCase {
  constructor(private readonly trustProfiles: TrustProfileRepository) {}

  async execute(userId: string): Promise<TrustProfileRecord> {
    const profile = await this.trustProfiles.findByUserId(userId);
    if (!profile) throw new TrustProfileNotFoundError(userId);
    return profile;
  }
}
