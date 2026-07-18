import { ValidationError } from "@/domain/errors/domain-error";
import type { AuthTokenRepository } from "@/domain/repositories/auth-token-repository";
import type { UserRepository } from "@/domain/repositories/user-repository";
import { hashToken } from "@/infrastructure/auth/tokens";

export class VerifyEmailUseCase {
  constructor(
    private readonly users: UserRepository,
    private readonly tokens: AuthTokenRepository,
  ) {}

  async execute(rawToken: string): Promise<void> {
    const match = await this.tokens.findValidEmailVerificationToken(hashToken(rawToken));
    if (!match) {
      throw new ValidationError("This verification link is invalid or has expired.");
    }

    await this.users.markEmailVerified(match.userId);
    await this.tokens.deleteEmailVerificationTokensForUser(match.userId);
  }
}
