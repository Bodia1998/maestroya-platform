import { ConflictError } from "@/domain/errors/domain-error";
import type { AuthTokenRepository } from "@/domain/repositories/auth-token-repository";
import type { UserRepository } from "@/domain/repositories/user-repository";
import { hashPassword } from "@/infrastructure/auth/password";
import {
  EMAIL_VERIFICATION_TOKEN_TTL_MS,
  generateRawToken,
  hashToken,
} from "@/infrastructure/auth/tokens";
import type { EmailSender } from "@/application/interfaces/email-sender";
import type { RegisterInput } from "@/application/dto/auth.dto";

export class RegisterUserUseCase {
  constructor(
    private readonly users: UserRepository,
    private readonly tokens: AuthTokenRepository,
    private readonly emailSender: EmailSender,
  ) {}

  async execute(input: RegisterInput): Promise<{ userId: string }> {
    const existing = await this.users.findByEmail(input.email);
    if (existing) {
      // Same message regardless of whether the email is OAuth-only or
      // password-registered already — do not leak which via the error.
      throw new ConflictError("An account with this email already exists.");
    }

    const passwordHash = await hashPassword(input.password);
    const user = await this.users.createWithPassword({
      email: input.email,
      name: input.name,
      passwordHash,
    });
    await this.users.assignDefaultRole(user.id, "CUSTOMER");

    const rawToken = generateRawToken();
    await this.tokens.createEmailVerificationToken(
      user.id,
      hashToken(rawToken),
      new Date(Date.now() + EMAIL_VERIFICATION_TOKEN_TTL_MS),
    );

    const verifyUrl = `${process.env.NEXT_PUBLIC_APP_URL}/auth/verify-email?token=${rawToken}`;
    await this.emailSender.send({
      to: input.email,
      subject: "Verify your MaestroYa email",
      html: `<p>Welcome to MaestroYa. Confirm your email address:</p><p><a href="${verifyUrl}">${verifyUrl}</a></p><p>This link expires in 24 hours.</p>`,
    });

    return { userId: user.id };
  }
}
