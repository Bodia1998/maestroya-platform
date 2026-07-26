import "server-only";

import { NextResponse } from "next/server";

import { DomainError } from "@/domain/errors/domain-error";
import { logger } from "@/infrastructure/observability/logger";
import { isProduction } from "@/infrastructure/config/env";

/**
 * Production-safe error → HTTP response mapping for Route Handlers
 * (Module 25 — Production Infrastructure).
 *
 * This codebase's business logic runs almost entirely through Server
 * Actions, each of which already catches its own `DomainError`s and
 * returns a typed `{ error }` shape to the client (see e.g.
 * `application/use-cases/**`) — that pattern is untouched here. This
 * utility exists for the smaller surface of actual Route Handlers
 * (`src/app/api/**`, e.g. the health checks below, and any future
 * webhook/REST endpoint) that need the same "never leak internals"
 * guarantee but respond over raw HTTP rather than a Server Action's
 * return value.
 *
 * Rules:
 *  - A known `DomainError` is expected, user-facing, and safe to return
 *    verbatim (its whole purpose is to carry a safe message) — see
 *    `domain/errors/domain-error.ts`.
 *  - Anything else is unexpected: full details (message, stack, name)
 *    are logged server-side with the request ID for correlation, and the
 *    client only ever receives a generic message plus that same request
 *    ID, so a user can reference it when contacting support without any
 *    internal detail (Prisma error text, file paths, stack traces,
 *    environment values) ever reaching them — especially important in
 *    production, where Next.js would otherwise be the only thing
 *    standing between a raw exception and the response body.
 */

const DOMAIN_ERROR_STATUS: Record<string, number> = {
  NOT_FOUND: 404,
  VALIDATION_ERROR: 400,
  UNAUTHORIZED: 401,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  ACCOUNT_RESTRICTED: 403,
};

export function toHttpErrorResponse(
  error: unknown,
  context: { requestId: string | null; route: string },
): NextResponse {
  if (error instanceof DomainError) {
    const status = DOMAIN_ERROR_STATUS[error.code] ?? 400;

    logger.warn("http_request_domain_error", {
      requestId: context.requestId ?? undefined,
      route: context.route,
      code: error.code,
      status,
    });

    return NextResponse.json(
      {
        error: error.message,
        code: error.code,
        requestId: context.requestId,
      },
      { status },
    );
  }

  logger.error("http_request_unhandled_error", {
    requestId: context.requestId ?? undefined,
    route: context.route,
    error,
  });

  return NextResponse.json(
    {
      error: isProduction
        ? "An unexpected error occurred. Please try again or contact support with this request ID."
        : error instanceof Error
          ? error.message
          : String(error),
      code: "INTERNAL_ERROR",
      requestId: context.requestId,
    },
    { status: 500 },
  );
}
