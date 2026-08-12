import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { env } from "@/infrastructure/config/env";
import { getCircuitBreakerStatusUseCase, getResetCircuitBreakerUseCase } from "@/infrastructure/health/compose";
import { logger } from "@/infrastructure/observability/logger";
import { REQUEST_ID_HEADER, resolveRequestId } from "@/infrastructure/observability/request-id";

/**
 * Circuit breaker status & manual reset (Module 56 — Health Checks &
 * Circuit Breakers).
 *
 * `GET` reports every registered breaker's full snapshot (state,
 * configuration, execution metrics) plus the same data reprojected as
 * Requirement 3's dependency-status shape — Requirement 6's "circuit
 * breaker status" and "dependency status" endpoints, combined, since
 * they are two views over identical data (see
 * `application/services/health/dependency-status.ts`).
 *
 * `POST` is the module's "manual reset" requirement — an operator
 * forcing one named breaker (or `"all"`) back to `CLOSED`. Deliberately
 * unauthenticated at this layer, consistent with every other route under
 * `/api/health/**` in this codebase (none of them require a session);
 * a deployment that wants to restrict this in production should do so
 * at the infrastructure layer (reverse proxy / IP allowlist), the same
 * way `CRON_SECRET`-style protection is applied selectively elsewhere
 * rather than baked into every health route.
 */
export async function GET(request: NextRequest) {
  const requestId = resolveRequestId(request.headers.get(REQUEST_ID_HEADER));

  if (env.HEALTH_CHECKS_ENABLED !== "true") {
    return NextResponse.json(
      { status: "disabled", timestamp: new Date().toISOString() },
      { status: 200, headers: { [REQUEST_ID_HEADER]: requestId } },
    );
  }

  const report = getCircuitBreakerStatusUseCase().execute();

  return NextResponse.json(
    { timestamp: new Date().toISOString(), ...report },
    { status: 200, headers: { [REQUEST_ID_HEADER]: requestId } },
  );
}

const resetRequestSchema = z.object({ name: z.string().min(1) });

export async function POST(request: NextRequest) {
  const requestId = resolveRequestId(request.headers.get(REQUEST_ID_HEADER));

  if (env.HEALTH_CHECKS_ENABLED !== "true") {
    return NextResponse.json(
      { status: "disabled" },
      { status: 200, headers: { [REQUEST_ID_HEADER]: requestId } },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Request body must be valid JSON with a 'name' field." },
      { status: 400, headers: { [REQUEST_ID_HEADER]: requestId } },
    );
  }

  const parsed = resetRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Request body must be { name: string } — a breaker name, or 'all'." },
      { status: 400, headers: { [REQUEST_ID_HEADER]: requestId } },
    );
  }

  const result = getResetCircuitBreakerUseCase().execute({ name: parsed.data.name });

  logger.info("circuit_breaker_manual_reset", { requestId, ...result });

  if (result.reset.length === 0) {
    return NextResponse.json(
      { error: `No circuit breaker named "${parsed.data.name}" is registered.`, ...result },
      { status: 404, headers: { [REQUEST_ID_HEADER]: requestId } },
    );
  }

  return NextResponse.json(result, { status: 200, headers: { [REQUEST_ID_HEADER]: requestId } });
}
