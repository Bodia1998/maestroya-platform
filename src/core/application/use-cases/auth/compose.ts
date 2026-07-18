import { PrismaAuthTokenRepository } from "@/infrastructure/database/prisma/repositories/prisma-auth-token-repository";
import { PrismaUserRepository } from "@/infrastructure/database/prisma/repositories/prisma-user-repository";
import { ConsoleEmailSender } from "@/infrastructure/email/console-email-sender";
import { RegisterUserUseCase } from "@/application/use-cases/auth/register-user.use-case";
import { RequestPasswordResetUseCase } from "@/application/use-cases/auth/request-password-reset.use-case";
import { ResetPasswordUseCase } from "@/application/use-cases/auth/reset-password.use-case";
import { VerifyEmailUseCase } from "@/application/use-cases/auth/verify-email.use-case";

/**
 * Manual composition root — no DI container in this project, so Server
 * Actions/Route Handlers import these factories instead of constructing
 * repositories inline. Swap ConsoleEmailSender for a real EmailSender
 * implementation here (and nowhere else) once an email provider is chosen.
 */
const users = new PrismaUserRepository();
const tokens = new PrismaAuthTokenRepository();
const emailSender = new ConsoleEmailSender();

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
