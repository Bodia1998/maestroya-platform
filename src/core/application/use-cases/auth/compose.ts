import { PrismaAuthTokenRepository } from "@/infrastructure/database/prisma/repositories/prisma-auth-token-repository";
import { PrismaUserRepository } from "@/infrastructure/database/prisma/repositories/prisma-user-repository";
import { ResendEmailSender } from "@/infrastructure/email/resend-email-sender";
import { env } from "@/infrastructure/config/env";
import { getTracer } from "@/infrastructure/tracing/compose";
import { withEmailTracing } from "@/infrastructure/tracing/traced-external-senders";
import { RegisterUserUseCase } from "@/application/use-cases/auth/register-user.use-case";
import { RequestPasswordResetUseCase } from "@/application/use-cases/auth/request-password-reset.use-case";
import { ResetPasswordUseCase } from "@/application/use-cases/auth/reset-password.use-case";
import { VerifyEmailUseCase } from "@/application/use-cases/auth/verify-email.use-case";

/**
 * Manual composition root — no DI container in this project, so Server
 * Actions/Route Handlers import these factories instead of constructing
 * repositories inline.
 *
 * Resend is wired here as the concrete EmailSender implementation.
 * Use cases depend only on the EmailSender interface, keeping the
 * application layer independent from the email provider.
 */
 
const users = new PrismaUserRepository();
const tokens = new PrismaAuthTokenRepository();
// Module 51 — Distributed Tracing: a decorator over the same
// `EmailSender` interface the use cases already depend on, returned
// untouched when tracing is disabled. Applied at the composition root so
// `RegisterUserUseCase`/`RequestPasswordResetUseCase` stay unaware of it,
// exactly as they are unaware that the sender is Resend at all.
const emailSender = withEmailTracing(
  new ResendEmailSender(env.RESEND_API_KEY, env.EMAIL_FROM),
  getTracer(),
);

export function makeRegisterUserUseCase() {
  return new RegisterUserUseCase(users, tokens, emailSender);
}

export function makeVerifyEmailUseCase() {
  return new VerifyEmailUseCase(users, tokens);
}

export function makeRequestPasswordResetUseCase() {
  return new RequestPasswordResetUseCase(users, tokens, emailSender);
}

export function makeResetPasswordUseCase() {
  return new ResetPasswordUseCase(users, tokens);
}
