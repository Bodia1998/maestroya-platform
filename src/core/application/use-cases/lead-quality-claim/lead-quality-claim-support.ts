import type { AdminRepository, AdminUserRecord } from "@/domain/repositories/admin-repository";
import type { LeadQualityClaimRepository } from "@/domain/repositories/lead-quality-claim-repository";
import {
  LEAD_QUALITY_CLAIM_ACTOR_ACTIVE_STATUS,
  LEAD_QUALITY_CLAIM_ALLOWED_ACTOR_ROLES,
  LeadQualityClaimRejectedError,
} from "@/domain/services/lead-quality-claim";

/**
 * Module 154 — shared helpers of the claim use cases.
 *
 * The actor is re-read through the existing `AdminRepository.getUserById` on EVERY administrative call: it must exist, be
 * ACTIVE and hold ADMIN or SUPER_ADMIN. A repository failure rejects (fail closed). A caller-supplied claim of a role is never trusted.
 */
export async function assertAuthorizedClaimAdmin(admins: Pick<AdminRepository, "getUserById">, actorUserId: unknown): Promise<string> {
  if (typeof actorUserId !== "string" || actorUserId.trim() === "") throw new LeadQualityClaimRejectedError("ACTOR_NOT_AUTHORIZED");
  const id = actorUserId.trim();
  let actor: AdminUserRecord | null;
  try {
    actor = await admins.getUserById(id);
  } catch {
    throw new LeadQualityClaimRejectedError("ACTOR_NOT_AUTHORIZED");
  }
  const allowed = LEAD_QUALITY_CLAIM_ALLOWED_ACTOR_ROLES as readonly string[];
  if (!actor || actor.status !== LEAD_QUALITY_CLAIM_ACTOR_ACTIVE_STATUS || !Array.isArray(actor.roles) || !actor.roles.some((role) => allowed.includes(role))) {
    throw new LeadQualityClaimRejectedError("ACTOR_NOT_AUTHORIZED");
  }
  return id;
}

/**
 * Separation of duties (M2): an administrator must not review or decide a claim of their OWN professional profile. Ownership is read
 * from persisted records (claim -> professional profile -> user), never from caller-supplied data. The refusal is the SAME generic
 * ACTOR_NOT_AUTHORIZED any unauthorized actor gets, so it reveals nothing about who owns the claim. Run it BEFORE any state check.
 */
export async function assertNotOwnClaim(claims: Pick<LeadQualityClaimRepository, "isClaimOwnedByUser">, claimId: string, actorId: string): Promise<void> {
  if (await claims.isClaimOwnedByUser(claimId, actorId)) throw new LeadQualityClaimRejectedError("ACTOR_NOT_AUTHORIZED");
}
