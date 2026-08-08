import type { RealtimeChannel } from "@/domain/value-objects/realtime-channel";
import type { RealtimeAccessChecker } from "@/application/ports/realtime-access-checker";

/**
 * Module 48 — Real-Time System.
 *
 * Decides whether a given authenticated principal may subscribe to a
 * given `RealtimeChannel` — the single choke point every subscribe
 * path (the SSE route, a future WebSocket gateway, `SubscribeToChannelUseCase`)
 * goes through, so "notifications are routed only to authorized
 * recipients" (this module's own requirement) is enforced in exactly one
 * place rather than re-implemented per transport.
 *
 * Role names are plain strings here (`"ADMIN"`, `"SUPER_ADMIN"`,
 * `"SUPPORT"`) rather than importing `ROLES` from
 * `infrastructure/auth/rbac.ts` — the application layer must not depend
 * on infrastructure (Clean Architecture's dependency rule), so the caller
 * (an infrastructure/interface-layer route handler) is responsible for
 * passing `getCurrentUser()`'s `roles` array through unchanged. These
 * literals are kept in sync with `ROLES` by the integration tests in
 * `tests/integration/realtime/`.
 */
export interface RealtimePrincipal {
  readonly userId: string;
  readonly roles: readonly string[];
}

const STAFF_ROLES = new Set(["ADMIN", "SUPER_ADMIN", "SUPPORT", "MODERATOR"]);

export class ChannelAuthorizationService {
  constructor(private readonly accessChecker: RealtimeAccessChecker) {}

  async canSubscribe(principal: RealtimePrincipal, channel: RealtimeChannel): Promise<boolean> {
    const isStaff = principal.roles.some((role) => STAFF_ROLES.has(role));

    switch (channel.type) {
      case "admin":
        return isStaff;

      case "user":
        return isStaff || principal.userId === channel.resourceId;

      case "professional":
        if (isStaff) return true;
        return this.accessChecker.isProfessionalOwner(principal.userId, channel.resourceId as string);

      case "company":
        if (isStaff) return true;
        return this.accessChecker.isCompanyMember(principal.userId, channel.resourceId as string);

      case "booking":
      case "quote":
      case "service-request":
        // Bookings/quotes/service-requests share the same Job-level
        // participant set in this domain model (customer, assigned
        // professional, assigned company's members) — see
        // `resolveDisputeParticipantUserIds` (application/use-cases/dispute),
        // which this checker's `isJobParticipant` mirrors, for why "booking"
        // maps onto `Job` rather than a separate entity.
        if (isStaff) return true;
        return this.accessChecker.isJobParticipant(principal.userId, channel.resourceId as string);

      case "dispute":
        if (isStaff) return true;
        return this.accessChecker.isDisputeParticipant(principal.userId, channel.resourceId as string);

      case "chat":
        if (isStaff) return true;
        return this.accessChecker.isConversationParticipant(principal.userId, channel.resourceId as string);

      case "search-index":
      case "job-queue":
        // Operational/ingestion progress channels — staff-only visibility.
        return isStaff;

      default: {
        const exhaustive: never = channel.type;
        return exhaustive;
      }
    }
  }
}
