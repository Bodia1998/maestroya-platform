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
}
