import { getLeadRolloutStatus } from "@/application/use-cases/lead-rollout/compose";
import type { LeadRolloutStatusView } from "@/domain/services/lead-rollout";
import { ROLES, requireRole } from "@/infrastructure/auth/rbac";

/**
 * Module 159 — read-only display of the LEAD_V1 rollout switch for the lead console ("kill-switch visibility", M157).
 *
 * A plain server-side helper, deliberately NOT a Server Action: the M157 console exposes a pinned set of actions and this adds none.
 * It carries the same administrator gate as every console read (`requireRole` first, ADMIN/SUPER_ADMIN only), reads the effective
 * state and changes nothing. The switch itself can only be changed through the deployment environment, never from here.
 */
export async function readLeadRolloutStatus(): Promise<LeadRolloutStatusView> {
  await requireRole(ROLES.ADMIN, ROLES.SUPER_ADMIN);
  return getLeadRolloutStatus();
}
