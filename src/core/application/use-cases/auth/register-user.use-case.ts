import { ConflictError } from "@/domain/errors/domain-error";
import type { AuthTokenRepository } from "@/domain/repositories/auth-token-repository";
import type { UserRepository } from "@/domain/repositories/user-repository";
import { hashPassword } from "@/infrastructure/auth/password";
import { env } from "@/infrastructure/config/env";
import {
  EMAIL_VERIFICATION_TOKEN_TTL_MS,
  generateRawToken,
  hashToken,
} from "@/infrastructure/auth/tokens";
import type { EmailSender } from "@/application/interfaces/email-sender";
import type { RegistrationAttributionLinker } from "@/application/ports/registration-attribution-linker";
import { renderActionLinkEmailHtml } from "@/infrastructure/email/email-template";
import type { RegisterInput } from "@/application/dto/auth.dto";

export class RegisterUserUseCase {
  constructor(
    private readonly users: UserRepository,
    private readonly tokens: AuthTokenRepository,
    private readonly emailSender: EmailSender,
    // Module 60 — Referral & Marketing Attribution Platform: optional so
    // every pre-existing caller/test that constructs this use case with
    // three arguments keeps compiling unchanged. See `execute`'s own
    // comment for why a failure here can never break registration.
    private readonly attributionLinker?: RegistrationAttributionLinker,
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
      // Professional Onboarding: recorded as a routing hint only —
      // registration itself is unchanged, every new account still gets
      // CUSTOMER below regardless of intent (see product decision in
      // docs — no separate account system, no different role at signup).
      signupIntent: input.intent === "PROFESSIONAL" ? "PROFESSIONAL" : undefined,
    });
    await this.users.assignDefaultRole(user.id, "CUSTOMER");

    // Module 60 — Referral & Marketing Attribution Platform: best-effort
    // link back to whatever visitor/attribution record tracked this
    // person before they signed up. Never allowed to affect registration
    // itself — mirrors the independent-side-effect pattern
    // `RefreshVerificationStatusUseCase` uses for its own non-critical
    // notification/audit-log calls (Module 59's doc, "does not raise
    // ProfessionalVerificationStatusChanged"): a failure here is caught,
    // never rethrown, and never blocks the response to the caller.
    if (this.attributionLinker && input.visitorId) {
      try {
        await this.attributionLinker.linkRegistration(user.id, input.visitorId);
      } catch {
        // Swallowed intentionally — see comment above.
      }
    }

    const rawToken = generateRawToken();
    await this.tokens.createEmailVerificationToken(
      user.id,
      hashToken(rawToken),
      new Date(Date.now() + EMAIL_VERIFICATION_TOKEN_TTL_MS),
    );

    const verifyUrl = `${env.NEXT_PUBLIC_APP_URL}/auth/verify-email?token=${rawToken}`;
    await this.emailSender.send({
      to: input.email,
      subject: "Verify your MaestroYa email",
      html: renderActionLinkEmailHtml({
        intro: "Welcome to MaestroYa. Confirm your email address:",
        actionUrl: verifyUrl,
        expiryNote: "This link expires in 24 hours.",
      }),
    });

    return { userId: user.id };
  }
}
