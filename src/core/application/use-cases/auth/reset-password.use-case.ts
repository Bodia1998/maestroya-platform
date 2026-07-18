import { ValidationError } from "@/domain/errors/domain-error";
import type { AuthTokenRepository } from "@/domain/repositories/auth-token-repository";
import type { UserRepository } from "@/domain/repositories/user-repository";
import { hashPassword } from "@/infrastructure/auth/password";
import { hashToken } from "@/infrastructure/auth/tokens";

export class ResetPasswordUseCase {
  constructor(
    private readonly users: UserRepository,
    private readonly tokens: AuthTokenRepository,
  ) {}

  async execute(rawToken: string, newPassword: string): Promise<void> {
    const tokenHash = hashToken(rawToken);
    const match = await this.tokens.findValidPasswordResetToken(tokenHash);
    if (!match) {
      throw new ValidationError("This reset link is invalid or has expired.");
    }

    const passwordHash = await hashPassword(newPassword);
    await this.users.updatePasswordHash(match.userId, passwordHash);
    await this.tokens.markPasswordResetTokenUsed(tokenHash);
    await this.tokens.deletePasswordResetTokensForUser(match.userId);
    // Resetting a password is a security-sensitive event — sign the user
    // out everywhere so a stolen session can't survive it.
    await this.tokens.revokeAllRefreshTokensForUser(match.userId);
  }
}
