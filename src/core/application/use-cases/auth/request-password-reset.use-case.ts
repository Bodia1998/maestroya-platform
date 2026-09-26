import { env } from "@/infrastructure/config/env";
import type { AuthTokenRepository } from "@/domain/repositories/auth-token-repository";
import type { UserRepository } from "@/domain/repositories/user-repository";
import {
  PASSWORD_RESET_TOKEN_TTL_MS,
  generateRawToken,
  hashToken,
} from "@/infrastructure/auth/tokens";
import type { EmailSender } from "@/application/interfaces/email-sender";
import { toLocale } from "@/shared/i18n/locales";
import type { AuthEmailComposer } from "@/application/ports/auth-email-composer";
import { IntlAuthEmailComposer } from "@/infrastructure/email/intl-auth-email-composer";

export class RequestPasswordResetUseCase {
  constructor(
    private readonly users: UserRepository,
    private readonly tokens: AuthTokenRepository,
    private readonly emailSender: EmailSender,
    // Module 120 — Multilingual Localization: see RegisterUserUseCase.
    private readonly emailComposer: AuthEmailComposer = new IntlAuthEmailComposer(),
  ) {}

  /**
   * Deliberately never throws or signals "email not found" — doing so
   * would let an attacker enumerate registered emails through this form.
   * Always resolves the same way; only sends an email if the account
   * actually exists and has a password (OAuth-only accounts have nothing
   * to reset).
   *
   * Module 120: the email is written in the account's stored
   * `preferredLocale` if it has one, else `options.locale` (the request
   * locale), else Spanish. The response is identical either way, so this
   * adds no enumeration signal.
   */
  async execute(email: string, options: { locale?: string | null } = {}): Promise<void> {
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
    const composed = this.emailComposer.composePasswordReset({
      locale: (await this.preferredLocale(user.id)) ?? options.locale,
      name: user.name,
      actionUrl: resetUrl,
      ttlMs: PASSWORD_RESET_TOKEN_TTL_MS,
    });
    await this.emailSender.send({ to: email, subject: composed.subject, html: composed.html });
  }

  private async preferredLocale(userId: string): Promise<string | null> {
    try {
      return toLocale(await this.users.getPreferredLocale(userId));
    } catch {
      return null;
    }
  }
}
