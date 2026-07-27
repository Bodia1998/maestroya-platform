import { env } from "@/infrastructure/config/env";
import type { AuthTokenRepository } from "@/domain/repositories/auth-token-repository";
import type { UserRepository } from "@/domain/repositories/user-repository";
import {
  PASSWORD_RESET_TOKEN_TTL_MS,
  generateRawToken,
  hashToken,
} from "@/infrastructure/auth/tokens";
import type { EmailSender } from "@/application/interfaces/email-sender";

export class RequestPasswordResetUseCase {
  constructor(
    private readonly users: UserRepository,
    private readonly tokens: AuthTokenRepository,
    private readonly emailSender: EmailSender,
  ) {}

  /**
   * Deliberately never throws or signals "email not found" — doing so
   * would let an attacker enumerate registered emails through this form.
   * Always resolves the same way; only sends an email if the account
   * actually exists and has a password (OAuth-only accounts have nothing
   * to reset).
   */
  async execute(email: string): Promise<void> {
    const user = await this.users.findByEmail(email);
    if (!user || !user.passwordHash) return;

    await this.tokens.deletePasswordResetTokensForUser(user.id);

    const rawToken = generateRawToken();
    await this.tokens.createPasswordResetToken(
      user.id,
      hashToken(rawToken),
      new Date(Date.now() + PASSWORD_RESET_TOKEN_TTL_MS),
    );

    const resetUrl = `${env.NEXT_PUBLIC_APP_URL}/auth/reset-password?token=${rawToken}`;
    await this.emailSender.send({
      to: email,
      subject: "Reset your MaestroYa password",
      html: `<p>Reset your password:</p><p><a href="${resetUrl}">${resetUrl}</a></p><p>This link expires in 1 hour. If you didn't request this, ignore this email.</p>`,
    });
  }
}
