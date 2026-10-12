import type { AdminRepository } from "@/domain/repositories/admin-repository";
import {
  LEAD_ADMIN_CONSOLE_ACTIVE_STATUS,
  LEAD_ADMIN_CONSOLE_ROLES,
  LeadAdminConsoleRejectedError,
} from "@/domain/services/lead-admin-console";

/**
 * Module 157 — every console READ re-validates the administrator inside the use case, exactly like the M154/M155/M156 use cases do for
 * their mutations: the actor is re-read through the existing `AdminRepository.getUserById` on EVERY call (must exist, be ACTIVE and
 * hold ADMIN or SUPER_ADMIN; a lookup failure denies, i.e. fail closed). The Server Action's `requireRole` is the first gate; this is
 * the second, so a future caller that forgets the first one still cannot read. One generic rejection for every denial.
 */
export async function assertLeadAdminConsoleActor(admins: Pick<AdminRepository, "getUserById">, actorUserId: unknown): Promise<string> {
  if (typeof actorUserId !== "string" || actorUserId.trim() === "") throw new LeadAdminConsoleRejectedError("ACTOR_NOT_AUTHORIZED");
  const id = actorUserId.trim();
  let actor;
  try {
    actor = await admins.getUserById(id);
  } catch {
    throw new LeadAdminConsoleRejectedError("ACTOR_NOT_AUTHORIZED");
  }
  const allowed = LEAD_ADMIN_CONSOLE_ROLES as readonly string[];
  if (!actor || actor.status !== LEAD_ADMIN_CONSOLE_ACTIVE_STATUS || !Array.isArray(actor.roles) || !actor.roles.some((role) => allowed.includes(role))) {
    throw new LeadAdminConsoleRejectedError("ACTOR_NOT_AUTHORIZED");
  }
  return id;
}
