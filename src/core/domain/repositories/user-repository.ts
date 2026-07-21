export interface AuthUserRecord {
  id: string;
  email: string | null;
  name: string | null;
  passwordHash: string | null;
  emailVerified: Date | null;
  status: string;
}

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
  }): Promise<AuthUserRecord>;
  updatePasswordHash(userId: string, passwordHash: string): Promise<void>;
  markEmailVerified(userId: string): Promise<void>;
  updateLastLoginAt(userId: string): Promise<void>;
  getRoleKeys(userId: string): Promise<string[]>;
  assignDefaultRole(userId: string, roleKey: string): Promise<void>;

  // --- Profile module additions ---
  findProfileById(userId: string): Promise<UserProfileRecord | null>;
  updateProfile(userId: string, data: UpdateProfileData): Promise<void>;
  updateAvatar(userId: string, imageUrl: string): Promise<void>;
  softDeleteAccount(userId: string): Promise<void>;
}
