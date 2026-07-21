import { UnauthorizedError, ValidationError } from "@/domain/errors/domain-error";
import type { AuthTokenRepository } from "@/domain/repositories/auth-token-repository";
import type { UserRepository } from "@/domain/repositories/user-repository";
import { hashPassword, verifyPassword } from "@/infrastructure/auth/password";

export class ChangePasswordUseCase {
  constructor(
    private readonly users: UserRepository,
    private readonly tokens: AuthTokenRepository,
  ) {}

  async execute(userId: string, currentPassword: string, newPassword: string): Promise<void> {
    const user = await this.users.findById(userId);
    if (!user || !user.passwordHash) {
      // OAuth-only accounts have no password to change from.
      throw new ValidationError("This account does not use a password.");
    }

    const currentMatches = await verifyPassword(currentPassword, user.passwordHash);
    if (!currentMatches) {
      throw new UnauthorizedError("Current password is incorrect.");
    }

    const newPasswordHash = await hashPassword(newPassword);
    await this.users.updatePasswordHash(userId, newPasswordHash);

    // Same reasoning as ResetPasswordUseCase: a password change is
    // security-sensitive, sign out everywhere else.
    await this.tokens.revokeAllRefreshTokensForUser(userId);
  }
}
