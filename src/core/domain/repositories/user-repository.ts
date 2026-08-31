export interface AuthUserRecord {
  id: string;
  email: string | null;
  name: string | null;
  passwordHash: string | null;
  emailVerified: Date | null;
  status: string;
}

/**
 * Professional Onboarding: a *temporary routing flag*, not a role — see
 * the `SignupIntent` enum's own doc comment in schema.prisma. A plain
 * string union (not the Prisma enum type) to stay consistent with this
 * repository's existing convention of not leaking generated Prisma types
 * across the domain boundary (see `ProfessionalStatusValue` in
 * professional-repository.ts for the same pattern).
 */
export type SignupIntentValue = "CUSTOMER" | "PROFESSIONAL";

export interface UserProfileRecord {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  image: string | null;
  timezone: string | null;
  notificationPreferences: Record<string, unknown> | null;
  preferredLanguageId: string | null;
  status: string;
  /** True if this account can sign in with a password (vs. OAuth-only). Never exposes the hash itself. */
  hasPassword: boolean;
}

export interface UpdateProfileData {
  name?: string;
  phone?: string | null;
  timezone?: string | null;
  preferredLanguageId?: string | null;
  notificationPreferences?: Record<string, unknown>;
}

/**
 * Repository interface for the subset of User operations the
 * Authentication module needs. Not a general-purpose UserRepository —
 * other modules (profiles, admin user management, etc.) should define
 * their own narrow interfaces for what they need rather than everyone
 * sharing one god-interface.
 */
export interface UserRepository {
  findByEmail(email: string): Promise<AuthUserRecord | null>;
  findById(id: string): Promise<AuthUserRecord | null>;
  createWithPassword(input: {
    email: string;
    name: string;
    passwordHash: string;
    /** Set only when registering through the "Soy profesional" CTA — see SignupIntentValue. */
    signupIntent?: SignupIntentValue;
  }): Promise<AuthUserRecord>;
  updatePasswordHash(userId: string, passwordHash: string): Promise<void>;
  markEmailVerified(userId: string): Promise<void>;
  updateLastLoginAt(userId: string): Promise<void>;
  getRoleKeys(userId: string): Promise<string[]>;
  assignDefaultRole(userId: string, roleKey: string): Promise<void>;

  // --- Professional Onboarding additions ---
  /** Null for any user not currently mid-way through professional onboarding. */
  getSignupIntent(userId: string): Promise<SignupIntentValue | null>;
  /** Called the moment onboarding completes — see CompleteProfessionalOnboardingUseCase. */
  clearSignupIntent(userId: string): Promise<void>;

  // --- Profile module additions ---
  findProfileById(userId: string): Promise<UserProfileRecord | null>;
  updateProfile(userId: string, data: UpdateProfileData): Promise<void>;
  updateAvatar(userId: string, imageUrl: string): Promise<void>;
  softDeleteAccount(userId: string): Promise<void>;

  // --- Internationalization additions (Module 29) ---

  /**
   * The user's stored **interface** language as a raw locale code, or
   * `null` when they have never explicitly chosen one (see
   * `User.preferredLocale` in schema.prisma — `null` is meaningful and
   * must not be collapsed into "Spanish" here; the resolution chain
   * upstream decides what absence means).
   *
   * Typed `string | null`, not `Locale | null`, on purpose: the domain
   * layer must not depend on the presentation module's list of shipped
   * languages, and a row written by an older/newer deployment could hold
   * a code this build no longer ships. Narrowing happens at the
   * application edge (`toLocale`), where an unknown code degrades to the
   * next step of the chain instead of throwing.
   *
   * Note this is a different concept from `preferredLanguageId` above —
   * see the schema doc comment for why the two are not merged.
   */
  getPreferredLocale(userId: string): Promise<string | null>;

  /** `null` clears the preference (back to "never chosen"). */
  updatePreferredLocale(userId: string, locale: string | null): Promise<void>;

  // --- Module 88: GDPR Erasure Execution ---

  /**
   * The erasure-execution idempotency guard: null while the account has
   * never been through `eraseAccount`, set to the moment it last was.
   * `ExecuteAccountErasureUseCase` reads this first, before doing any
   * mutation, to decide whether this is a fresh run or a safe-to-skip
   * retry of an already-completed erasure (see that use case's own doc
   * comment, and `User.personalDataErasedAt`'s in schema.prisma).
   */
  getErasureState(userId: string): Promise<{ personalDataErasedAt: Date | null } | null>;

  /**
   * Anonymizes this User row's own personal-data fields in place —
   * name/email/phone/image/passwordHash/notificationPreferences cleared or
   * replaced with a pseudonymous placeholder, `status` moved to
   * DEACTIVATED, `deletedAt`/`personalDataErasedAt` stamped. The row
   * itself is never hard-deleted (see this method's Prisma implementation
   * doc comment for why: every marketplace/financial/audit table that
   * references a user does so with an `onDelete: Restrict` or `SetNull`
   * foreign key, precisely so those records keep displaying *something*
   * for this user after they leave — anonymizing the one shared User row
   * anonymizes every one of those joins for free, with no need to touch
   * Message/Review/CompanyMember/Job/etc. individually).
   *
   * Idempotent at the database level: implementations only apply the
   * update `WHERE id = ? AND personalDataErasedAt IS NULL`, so two
   * concurrent calls for the same user converge on exactly one anonymizing
   * write — the loser sees `erased: false` and the use case treats that
   * the same as an already-erased account.
   *
   * Returns `erased: false` (no fields touched) if the account was already
   * erased or does not exist.
   */
  eraseAccount(userId: string): Promise<{ erased: boolean }>;

  /**
   * Hard-deletes every row that could let this user keep authenticating
   * after erasure: NextAuth `Session` rows (server-persisted sessions —
   * see auth-config.ts's own doc comment for why the *cookie* session
   * strategy is `"jwt"`, which this method cannot revoke; see
   * ExecuteAccountErasureUseCase's doc comment for the documented
   * limitation that follows from that) and linked OAuth `Account` rows
   * (Google/Apple/Facebook — deleting these means a future OAuth sign-in
   * attempt can no longer silently resume this identity). Does not touch
   * `RefreshToken`/`EmailVerificationToken`/`PasswordResetToken` — those
   * already have their own revoke/delete methods on `AuthTokenRepository`,
   * which `ExecuteAccountErasureUseCase` calls directly rather than this
   * repository re-declaring them.
   */
  invalidateAllSessions(userId: string): Promise<void>;
}
