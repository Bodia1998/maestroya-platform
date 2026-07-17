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
