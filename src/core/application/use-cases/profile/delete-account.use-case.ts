import { UnauthorizedError, ValidationError } from "@/domain/errors/domain-error";
import type { AuthTokenRepository } from "@/domain/repositories/auth-token-repository";
import type { UserRepository } from "@/domain/repositories/user-repository";
import { verifyPassword } from "@/infrastructure/auth/password";

export class DeleteAccountUseCase {
  constructor(
    private readonly users: UserRepository,
    private readonly tokens: AuthTokenRepository,
  ) {}

  async execute(userId: string, password?: string): Promise<void> {
    const user = await this.users.findById(userId);

    // Password-based accounts must confirm with their password.
    // OAuth-only accounts (no passwordHash) have nothing to check
    // against and skip this entirely — still gated by the caller's
    // requireAuth(), not re-checked here.
    if (user?.passwordHash) {
      if (!password) {
        throw new ValidationError("Enter your password to confirm.");
      }
      const matches = await verifyPassword(password, user.passwordHash);
      if (!matches) {
        throw new UnauthorizedError("Incorrect password.");
      }
    }

    await this.users.softDeleteAccount(userId);
    await this.tokens.revokeAllRefreshTokensForUser(userId);
  }
}
