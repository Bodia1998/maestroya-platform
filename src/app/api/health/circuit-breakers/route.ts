import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { env } from "@/infrastructure/config/env";
import { getCircuitBreakerStatusUseCase, getResetCircuitBreakerUseCase } from "@/infrastructure/health/compose";
import { ROLES, requireRole } from "@/infrastructure/auth/rbac";
import { toHttpErrorResponse } from "@/infrastructure/observability/http-error-response";
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
 * forcing one named breaker (or `"all"`) back to `CLOSED`, a genuine
 * state-mutating financial/operational action (it changes live
 * traffic-shaping behavior), not merely a read.
 *
 * ## Module 70.1 — Pre-Stripe Security & Integration Hardening
 * The Module 70 audit flagged this route as unauthenticated — both `GET`
 * (breaker configuration/metrics/dependency topology) and `POST` (an
 * operator-only mutation reachable by anyone). Both now require
 * `ADMIN`/`SUPER_ADMIN` via the same existing `requireRole` RBAC seam
 * `/api/analytics/dashboard/route.ts`/`/api/health/diagnostics/route.ts`
 * already use — no new/separate auth mechanism. This supersedes the
 * route's previous doc comment, which described deliberately leaving it
 * unauthenticated "consistent with every other route under
 * /api/health/**" — `/api/health` and `/api/health/ready` (Module 25)
 * remain intentionally public liveness/readiness probes; this route and
 * `/api/health/diagnostics` are the two that expose internal topology and
 * are now both gated the same way.
 */
export async function GET(request: NextRequest) {
  const requestId = resolveRequestId(request.headers.get(REQUEST_ID_HEADER));
  const route = "/api/health/circuit-breakers";

  try {
    await requireRole(ROLES.ADMIN, ROLES.SUPER_ADMIN);
  } catch (error) {
    return toHttpErrorResponse(error, { requestId, route });
  }

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
  const route = "/api/health/circuit-breakers";

  try {
    await requireRole(ROLES.ADMIN, ROLES.SUPER_ADMIN);
  } catch (error) {
    return toHttpErrorResponse(error, { requestId, route });
  }

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
