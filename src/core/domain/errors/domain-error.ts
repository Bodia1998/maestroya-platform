/**
 * Base error type for the domain layer.
 *
 * Use cases in the application layer catch and translate these into
 * whatever shape the delivery mechanism needs (an HTTP status code in a
 * Route Handler, a form error in a Server Action, etc.). The domain layer
 * itself never knows about HTTP, so it only ever throws these.
 */
export abstract class DomainError extends Error {
  abstract readonly code: string;

  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class NotFoundError extends DomainError {
  readonly code = "NOT_FOUND";

  constructor(entity: string, id: string) {
    super(`${entity} with id "${id}" was not found.`);
  }
}

export class ValidationError extends DomainError {
  readonly code = "VALIDATION_ERROR";

  constructor(message: string) {
    super(message);
  }
}

export class UnauthorizedError extends DomainError {
  readonly code = "UNAUTHORIZED";

  constructor(message = "You are not authorized to perform this action.") {
    super(message);
  }
}

export class ConflictError extends DomainError {
  readonly code = "CONFLICT";

  constructor(message: string) {
    super(message);
  }
}

/**
 * Security & Anti-Abuse module (Module 24): thrown when a caller has
 * exceeded a configured rate-limit policy (see
 * application/ports/rate-limit-policies.ts). `retryAfterMs` is safe to
 * surface to the client (how long to wait) — never expose the underlying
 * limit/window/current-count, which would help an attacker tune their
 * request rate to just under the threshold.
 */
export class RateLimitedError extends DomainError {
  readonly code = "RATE_LIMITED";
  readonly retryAfterMs: number;

  constructor(message = "Too many requests. Please try again later.", retryAfterMs: number) {
    super(message);
    this.retryAfterMs = retryAfterMs;
  }
}

/**
 * Security & Anti-Abuse module (Module 24): thrown when an authenticated
 * user is temporarily blocked by an active AccountRestriction (see
 * domain/repositories/account-restriction-repository.ts). The message is
 * deliberately generic — the internal reason category and expiry are
 * never surfaced to the restricted user, only ever to an admin via the
 * dedicated admin-only read path.
 */
export class AccountRestrictedError extends DomainError {
  readonly code = "ACCOUNT_RESTRICTED";

  constructor(message = "This action is temporarily unavailable for your account.") {
    super(message);
  }
}

/**
 * Module 35 — Payment Domain Model Preparation: thrown by the `Payment`
 * aggregate (`domain/entities/payment.ts`) when a caller requests a status
 * change its lifecycle does not allow from the current status — e.g.
 * capturing a payment that already `FAILED`, or refunding one that was
 * never `CAPTURED`. Raised from inside the aggregate itself (see
 * `Payment.transitionTo`/`Payment.refund`), not re-validated ad hoc at
 * every call site, so "invalid state changes are prevented" is a property
 * of `Payment` itself — true for today's application code and for the
 * Module 59 Stripe webhook handler that will call these same methods.
 */
export class InvalidPaymentTransitionError extends DomainError {
  readonly code = "INVALID_PAYMENT_TRANSITION";

  constructor(message: string) {
    super(message);
  }
}
