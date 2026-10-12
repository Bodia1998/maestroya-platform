import type { AdminRepository } from "@/domain/repositories/admin-repository";
import {
  LEAD_FEE_DISPUTE_ACTOR_ACTIVE_STATUS,
  LEAD_FEE_DISPUTE_ALLOWED_ACTOR_ROLES,
  LeadFeeDisputeRejectedError,
} from "@/domain/services/lead-fee-dispute";

/**
 * Module 155 — the administrator is re-read through the existing `AdminRepository.getUserById` on EVERY call (never trusted from the
 * caller): it must exist, be ACTIVE and hold ADMIN or SUPER_ADMIN. A lookup failure denies. One generic rejection for every denial.
 */
export async function assertLeadFeeDisputeAdminActor(admins: Pick<AdminRepository, "getUserById">, actorUserId: string): Promise<void> {
  let actor;
  try {
    actor = await admins.getUserById(actorUserId);
  } catch {
    throw new LeadFeeDisputeRejectedError("ACTOR_NOT_AUTHORIZED");
  }
  const allowed = LEAD_FEE_DISPUTE_ALLOWED_ACTOR_ROLES as readonly string[];
  if (!actor || actor.status !== LEAD_FEE_DISPUTE_ACTOR_ACTIVE_STATUS || !Array.isArray(actor.roles) || !actor.roles.some((role) => allowed.includes(role))) {
    throw new LeadFeeDisputeRejectedError("ACTOR_NOT_AUTHORIZED");
  }
}
