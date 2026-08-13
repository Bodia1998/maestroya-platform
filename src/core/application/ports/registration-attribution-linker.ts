/**
 * Module 60 — Referral & Marketing Attribution Platform: the one-method
 * port `RegisterUserUseCase` depends on to (best-effort) link a brand-new
 * user back to whatever visitor/attribution record tracked them before
 * they signed up. Kept as a tiny port — rather than having
 * `register-user.use-case.ts` import `MarketingAttributionRepository`
 * directly — so the Auth module's use case stays independent of the
 * Referral module's persistence shape, the same "depend on a narrow port,
 * not another module's repository" convention `EmailSender`/
 * `AuthTokenRepository` already establish for that same use case.
 */
export interface RegistrationAttributionLinker {
  /**
   * Best-effort only: implementations must never throw in a way that could
   * break registration — `RegisterUserUseCase` itself also wraps this call
   * in a try/catch, but a well-behaved implementation should already
   * swallow its own persistence failures internally and log/report them
   * instead.
   */
  linkRegistration(userId: string, visitorId: string | null): Promise<void>;
}
