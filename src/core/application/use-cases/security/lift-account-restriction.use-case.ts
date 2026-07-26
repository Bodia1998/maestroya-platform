import { NotFoundError } from "@/domain/errors/domain-error";
import type {
  AccountRestrictionRecord,
  AccountRestrictionRepository,
} from "@/domain/repositories/account-restriction-repository";
import type { SecurityEventRepository } from "@/domain/repositories/security-event-repository";

/**
 * Security & Anti-Abuse module (Module 24): admin-only early release of a
 * restriction (before its natural `expiresAt`, or an indefinite one).
 * `adminUserId` is resolved the same way as CreateAccountRestrictionUseCase
 * — never client-supplied.
 */
export class LiftAccountRestrictionUseCase {
  constructor(
    private readonly restrictions: AccountRestrictionRepository,
    private readonly securityEvents: SecurityEventRepository,
  ) {}

  async execute(adminUserId: string, restrictionId: string): Promise<AccountRestrictionRecord> {
    const lifted = await this.restrictions.lift(restrictionId, new Date());
    if (!lifted) {
      throw new NotFoundError("AccountRestriction", restrictionId);
    }

    await this.securityEvents.record({
      type: "ADMIN_ACTION",
      userId: lifted.userId,
      metadata: { adminAction: "ACCOUNT_RESTRICTION_LIFTED", adminUserId, restrictionId },
    });

    return lifted;
  }
}
