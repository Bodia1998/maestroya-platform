export interface AuthUserRecord {
  id: string;
  email: string | null;
  name: string | null;
  passwordHash: string | null;
  emailVerified: Date | null;
  status: string;
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
}
