import { UnauthorizedError } from "@/domain/errors/domain-error";
import type { RealtimeHub } from "@/application/services/realtime/realtime-hub";
import type { PresenceSnapshot } from "@/application/ports/presence-store";

const STAFF_ROLES = new Set(["ADMIN", "SUPER_ADMIN", "SUPPORT", "MODERATOR"]);

/**
 * Module 48 — Real-Time System (query).
 *
 * Returns one user's presence snapshot (online/offline, active device
 * count, last seen). Only the user themselves or platform staff may read
 * it — presence is personal information (it reveals when someone is
 * active), the same authorization posture as every other "read my own
 * data or staff can read anyone's" query in this codebase (e.g.
 * `ListMyDisputesUseCase` vs `ListAdminDisputesUseCase`).
 */
export class GetPresenceUseCase {
  constructor(private readonly hub: RealtimeHub) {}

  execute(input: { requestedByUserId: string; requestedByRoles: readonly string[]; targetUserId: string }): PresenceSnapshot {
    const isSelf = input.requestedByUserId === input.targetUserId;
    const isStaff = input.requestedByRoles.some((role) => STAFF_ROLES.has(role));
    if (!isSelf && !isStaff) {
      throw new UnauthorizedError("You are not authorized to view this user's presence.");
    }
    return this.hub.presenceOf(input.targetUserId);
  }
}
