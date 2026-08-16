import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { env } from "@/infrastructure/config/env";
import { getCircuitBreakerStatusUseCase, getPlatformHealthUseCase } from "@/infrastructure/health/compose";
import { ROLES, requireRole } from "@/infrastructure/auth/rbac";
import { toHttpErrorResponse } from "@/infrastructure/observability/http-error-response";
import { logger } from "@/infrastructure/observability/logger";
import { REQUEST_ID_HEADER, resolveRequestId } from "@/infrastructure/observability/request-id";

/**
 * Operational diagnostics (Module 56 — Health Checks & Circuit Breakers).
 *
 * The single endpoint that surfaces everything Requirement 6 asks for in
 * one place: overall platform status, every individual subsystem's
 * status, every external dependency's status, and every circuit
 * breaker's state — for an operator who wants the full picture, not one
 * probe's narrow answer.
 *
 * Deliberately a brand-new route, never a change to `/api/health` or
 * `/api/health/ready` — those two keep their existing Module 25/44-55
 * contracts and HTTP-status semantics exactly as documented in their own
 * files. This endpoint always returns 200 once authorized (its purpose is
 * visibility, not gating traffic/orchestration — same "operational
 * visibility only" category `/api/health/ready`'s own `checks.*` fields
 * already establish, applied to the whole response here rather than to
 * individual fields there); `status` in the JSON body is what actually
 * conveys platform health to a human or dashboard reading it.
 *
 * ## Module 70.1 — Pre-Stripe Security & Integration Hardening
 * The Module 70 audit flagged this route as exposing internal
 * topology/dependency information (subsystem names, dependency health,
 * circuit-breaker configuration/metrics) to any unauthenticated caller.
 * Now gated by `requireRole(ADMIN, SUPER_ADMIN)` — the exact same
 * existing RBAC seam `/api/analytics/dashboard/route.ts` already uses for
 * its own platform-operational data, never a new/separate auth
 * mechanism. Auth runs first, before the `HEALTH_CHECKS_ENABLED` check or
 * any health-check execution — no side effect (not even the cheap "is
 * this feature enabled" branch) happens before authorization.
 */
export async function GET(request: NextRequest) {
  const requestId = resolveRequestId(request.headers.get(REQUEST_ID_HEADER));
  const route = "/api/health/diagnostics";

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

  try {
    const [platformHealth, circuitBreakerStatus] = await Promise.all([
      getPlatformHealthUseCase().execute(),
      Promise.resolve(getCircuitBreakerStatusUseCase().execute()),
    ]);

    return NextResponse.json(
      {
        status: platformHealth.status,
        timestamp: platformHealth.timestamp,
        subsystems: platformHealth.checks,
        dependencies: circuitBreakerStatus.dependencies,
        circuitBreakers: circuitBreakerStatus.circuitBreakers,
      },
      { status: 200, headers: { [REQUEST_ID_HEADER]: requestId } },
    );
  } catch (error) {
    // Belt-and-braces only — every contributor already catches its own
    // errors (see `HealthCheckRegistry.runOne`), so reaching here means a
    // bug in the aggregation path itself, not a dependency failure.
    logger.error("diagnostics_check_failed", { requestId, route: "/api/health/diagnostics", error });

    return NextResponse.json(
      { status: "UNHEALTHY", timestamp: new Date().toISOString(), error: "diagnostics collection failed" },
      { status: 200, headers: { [REQUEST_ID_HEADER]: requestId } },
    );
  }
}
