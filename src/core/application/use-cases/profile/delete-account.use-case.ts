import { UnauthorizedError, ValidationError } from "@/domain/errors/domain-error";
import type { UserRepository } from "@/domain/repositories/user-repository";
import { verifyPassword } from "@/infrastructure/auth/password";
import type { ExecuteAccountErasureUseCase } from "@/application/use-cases/gdpr/execute-account-erasure.use-case";

export class DeleteAccountUseCase {
  constructor(
    private readonly users: UserRepository,
    /**
     * Module 88 — GDPR Erasure Execution & Document Retention: the
     * self-service "Delete my account" flow (this use case, wired to the
     * real `deleteAccountAction` Server Action in
     * `src/app/(dashboard)/profile/actions.ts`) is this platform's one
     * actual end-user-reachable trigger for GDPR Article 17 erasure —
     * rather than adding a second, parallel "are you sure" UI, this use
     * case now delegates the real anonymization/hard-delete work to
     * `ExecuteAccountErasureUseCase` after confirming the password.
     * `ExecuteAccountErasureUseCase` itself owns all token/session
     * revocation (see its own doc comment) — this use case no longer
     * takes an `AuthTokenRepository` directly, to avoid two places
     * independently deciding what "revoke everything" means.
     */
    private readonly erasure: ExecuteAccountErasureUseCase,
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

    await this.erasure.execute(userId, { userId, isAdmin: false });
  }
}
