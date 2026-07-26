import { ValidationError } from "@/domain/errors/domain-error";
import type {
  AccountRestrictionRecord,
  AccountRestrictionRepository,
} from "@/domain/repositories/account-restriction-repository";
import type { SecurityEventRepository } from "@/domain/repositories/security-event-repository";
import type { CreateAccountRestrictionInput } from "@/application/dto/security.dto";

/**
 * Security & Anti-Abuse module (Module 24): the only way an *explicit*
 * (non-automated) AccountRestriction gets created — an admin action.
 * `adminUserId` must be the session's own id, resolved by
 * `requireRole(SUPER_ADMIN)` at the Server Action boundary (see
 * ListSecurityEventsUseCase's doc comment for the same convention), never
 * client-supplied.
 *
 * An admin decision is the one path allowed to omit `durationMinutes` for
 * an indefinite restriction (see account-restriction-repository.ts's
 * "no permanent auto-bans" rule — that rule is specifically about the
 * *automated* AntiAbuseService path, not this reviewed, explicit one).
 */
export class CreateAccountRestrictionUseCase {
  constructor(
    private readonly restrictions: AccountRestrictionRepository,
    private readonly securityEvents: SecurityEventRepository,
  ) {}

  async execute(
    adminUserId: string,
    input: CreateAccountRestrictionInput,
  ): Promise<AccountRestrictionRecord> {
    if (input.userId === adminUserId) {
      throw new ValidationError("An admin cannot restrict their own account.");
    }

    const expiresAt = input.durationMinutes
      ? new Date(Date.now() + input.durationMinutes * 60 * 1000)
      : null;

    const restriction = await this.restrictions.create({
      userId: input.userId,
      state: input.state,
      reason: input.reason,
      notes: input.notes ?? null,
      createdByUserId: adminUserId,
      expiresAt,
    });

    await this.securityEvents.record({
      type: "ADMIN_ACTION",
      userId: input.userId,
      metadata: {
        adminAction: "ACCOUNT_RESTRICTION_CREATED",
        adminUserId,
        state: input.state,
        reason: input.reason,
      },
    });

    return restriction;
  }
}
