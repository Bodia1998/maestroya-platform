import type { AuthTokenRepository } from "@/domain/repositories/auth-token-repository";
import type { AuthUserRecord, UserRepository } from "@/domain/repositories/user-repository";
import type { EmailMessage, EmailSender } from "@/application/interfaces/email-sender";

/**
 * In-memory test doubles for the auth integration tests. These implement
 * the same interfaces the Prisma repositories do, so the use-cases under
 * test run their real orchestration logic — the only thing swapped out is
 * where the data lives. No database needed to get a genuine signal on
 * whether RegisterUserUseCase → VerifyEmailUseCase → password reset flow
 * actually behaves correctly end to end.
 */

let idCounter = 0;
function nextId() {
  idCounter += 1;
  return `fake-id-${idCounter}`;
}

export class FakeUserRepository implements UserRepository {
  users = new Map<string, AuthUserRecord>();
  rolesByUserId = new Map<string, Set<string>>();

  async findByEmail(email: string) {
    return [...this.users.values()].find((u) => u.email === email) ?? null;
  }

  async findById(id: string) {
    return this.users.get(id) ?? null;
  }

  async createWithPassword(input: { email: string; name: string; passwordHash: string }) {
    const user: AuthUserRecord = {
      id: nextId(),
      email: input.email,
      name: input.name,
      passwordHash: input.passwordHash,
      emailVerified: null,
      status: "PENDING_VERIFICATION",
    };
    this.users.set(user.id, user);
    return user;
  }

  async updatePasswordHash(userId: string, passwordHash: string) {
    const user = this.users.get(userId);
    if (user) user.passwordHash = passwordHash;
  }

  async markEmailVerified(userId: string) {
    const user = this.users.get(userId);
    if (user) {
      user.emailVerified = new Date();
      user.status = "ACTIVE";
    }
  }

  async updateLastLoginAt() {
    // not needed for these tests
  }

  async getRoleKeys(userId: string) {
    return [...(this.rolesByUserId.get(userId) ?? [])];
  }

  async assignDefaultRole(userId: string, roleKey: string) {
    const roles = this.rolesByUserId.get(userId) ?? new Set<string>();
    roles.add(roleKey);
    this.rolesByUserId.set(userId, roles);
  }
}

interface StoredToken {
  userId: string;
  expiresAt: Date;
  usedAt?: Date;
  revokedAt?: Date;
}

export class FakeAuthTokenRepository implements AuthTokenRepository {
  emailVerificationTokens = new Map<string, StoredToken>();
  passwordResetTokens = new Map<string, StoredToken>();
  refreshTokens = new Map<string, StoredToken>();

  async createEmailVerificationToken(userId: string, tokenHash: string, expiresAt: Date) {
    this.emailVerificationTokens.set(tokenHash, { userId, expiresAt });
  }

  async findValidEmailVerificationToken(tokenHash: string) {
    const token = this.emailVerificationTokens.get(tokenHash);
    if (!token || token.expiresAt < new Date()) return null;
    return { userId: token.userId };
  }

  async deleteEmailVerificationTokensForUser(userId: string) {
    for (const [hash, token] of this.emailVerificationTokens) {
      if (token.userId === userId) this.emailVerificationTokens.delete(hash);
    }
  }

  async createPasswordResetToken(userId: string, tokenHash: string, expiresAt: Date) {
    this.passwordResetTokens.set(tokenHash, { userId, expiresAt });
  }

  async findValidPasswordResetToken(tokenHash: string) {
    const token = this.passwordResetTokens.get(tokenHash);
    if (!token || token.usedAt || token.expiresAt < new Date()) return null;
    return { userId: token.userId };
  }

  async markPasswordResetTokenUsed(tokenHash: string) {
    const token = this.passwordResetTokens.get(tokenHash);
    if (token) token.usedAt = new Date();
  }

  async deletePasswordResetTokensForUser(userId: string) {
    for (const [hash, token] of this.passwordResetTokens) {
      if (token.userId === userId) this.passwordResetTokens.delete(hash);
    }
  }

  async createRefreshToken(input: { userId: string; tokenHash: string; expiresAt: Date }) {
    this.refreshTokens.set(input.tokenHash, { userId: input.userId, expiresAt: input.expiresAt });
  }

  async findValidRefreshToken(tokenHash: string) {
    const token = this.refreshTokens.get(tokenHash);
    if (!token || token.revokedAt || token.expiresAt < new Date()) return null;
    return { userId: token.userId };
  }

  async revokeRefreshToken(tokenHash: string) {
    const token = this.refreshTokens.get(tokenHash);
    if (token) token.revokedAt = new Date();
  }

  async revokeAllRefreshTokensForUser(userId: string) {
    for (const token of this.refreshTokens.values()) {
      if (token.userId === userId) token.revokedAt = new Date();
    }
  }
}

export class FakeEmailSender implements EmailSender {
  sent: EmailMessage[] = [];

  async send(message: EmailMessage) {
    this.sent.push(message);
  }
}
