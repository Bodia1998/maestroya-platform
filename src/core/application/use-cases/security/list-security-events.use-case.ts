import type {
  ListSecurityEventsOptions,
  SecurityEventRecord,
  SecurityEventRepository,
} from "@/domain/repositories/security-event-repository";

/**
 * Security & Anti-Abuse module (Module 24): admin oversight listing.
 * Trusts the caller has already been authorized via
 * `requireRole(SUPER_ADMIN)` at the Server Action boundary — same
 * convention as every other `ListAdmin*UseCase` in this codebase (see
 * ListAdminDisputesUseCase). Deliberately SUPER_ADMIN-only, not
 * ADMIN/SUPPORT — security events can reveal account-enumeration-relevant
 * detail (which emails exist, login timing) that even regular admin/
 * support staff don't need for their day-to-day moderation work.
 */
export class ListSecurityEventsUseCase {
  constructor(private readonly securityEvents: SecurityEventRepository) {}

  async execute(options: ListSecurityEventsOptions): Promise<SecurityEventRecord[]> {
    return this.securityEvents.list(options);
  }
}
