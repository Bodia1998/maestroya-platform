import type {
  AccountRestrictionRecord,
  AccountRestrictionRepository,
  ListAccountRestrictionsOptions,
} from "@/domain/repositories/account-restriction-repository";

/**
 * Security & Anti-Abuse module (Module 24): admin oversight listing — see
 * ListSecurityEventsUseCase's doc comment for the same SUPER_ADMIN-only
 * authorization convention (enforced by the caller, not here).
 */
export class ListAccountRestrictionsUseCase {
  constructor(private readonly restrictions: AccountRestrictionRepository) {}

  async execute(options: ListAccountRestrictionsOptions): Promise<AccountRestrictionRecord[]> {
    return this.restrictions.list(options);
  }
}
