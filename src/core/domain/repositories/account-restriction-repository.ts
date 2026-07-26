/**
 * Security & Anti-Abuse module (Module 24): temporary abuse-state on a
 * User, kept as its own table rather than a status column on User (see
 * schema.prisma's AccountRestriction doc comment for the full reasoning —
 * short version: User.status is the account-lifecycle/moderation decision,
 * this is a temporary, often-automated overlay on top of it).
 */
export type AccountRestrictionState = "THROTTLED" | "TEMPORARILY_BLOCKED" | "FLAGGED";

export type AccountRestrictionReason =
  | "FAILED_LOGIN_BURST"
  | "REGISTRATION_ABUSE"
  | "SERVICE_REQUEST_SPAM"
  | "QUOTE_SPAM"
  | "MESSAGE_SPAM"
  | "REVIEW_ABUSE"
  | "ADMIN_DECISION"
  | "OTHER";

export interface CreateAccountRestrictionData {
  userId: string;
  state: AccountRestrictionState;
  reason: AccountRestrictionReason;
  /** Internal only — never returned to the restricted user (see
   *  application/dto/security.dto.ts's admin-facing mapper, the only
   *  place this field may ever be read back out). */
  notes?: string | null;
  /** Null = automated (the anti-abuse policy layer itself). Set = an
   *  explicit admin action. Only an explicit admin action may pass
   *  `expiresAt: null` (indefinite, until manually lifted) — see this
   *  method's own runtime check in the Prisma implementation and
   *  schema.prisma's doc comment ("no permanent auto-bans"). */
  createdByUserId?: string | null;
  expiresAt: Date | null;
}

export interface AccountRestrictionRecord {
  id: string;
  userId: string;
  state: AccountRestrictionState;
  reason: AccountRestrictionReason;
  notes: string | null;
  createdByUserId: string | null;
  expiresAt: Date | null;
  liftedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ListAccountRestrictionsOptions {
  userId?: string;
  limit: number;
  offset: number;
}

export interface AccountRestrictionRepository {
  create(data: CreateAccountRestrictionData): Promise<AccountRestrictionRecord>;

  /**
   * The single active (not lifted, not expired as of `now`) restriction
   * with the *most severe* state for this user, or null. "Most severe"
   * ordering is TEMPORARILY_BLOCKED > THROTTLED > FLAGGED — see
   * domain/services/account-restriction-rules.ts, the pure function this
   * delegates the ordering decision to so it stays unit-testable without a
   * database.
   */
  findActiveForUser(userId: string, now: Date): Promise<AccountRestrictionRecord | null>;

  /** Admin-only lift — sets `liftedAt`. Returns null if no such
   *  restriction exists (never throws NotFound; the calling use case
   *  decides how to surface that). */
  lift(id: string, now: Date): Promise<AccountRestrictionRecord | null>;

  /** Admin-only oversight listing, newest first. */
  list(options: ListAccountRestrictionsOptions): Promise<AccountRestrictionRecord[]>;
}
