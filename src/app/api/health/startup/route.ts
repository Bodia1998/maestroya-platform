import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { prisma } from "@/infrastructure/database/prisma/client";
import { logger } from "@/infrastructure/observability/logger";
import { REQUEST_ID_HEADER, resolveRequestId } from "@/infrastructure/observability/request-id";

/**
 * Startup probe (Module 56 — Health Checks & Circuit Breakers).
 *
 * Answers "has this instance finished its one-time initialization and
 * become able to serve traffic at all?" — the third probe kind
 * alongside `/api/health` (liveness) and `/api/health/ready`
 * (readiness), following the same Kubernetes-style separation of
 * concerns Module 25's `/api/health` doc comment already established for
 * those two.
 *
 * A dedicated startup probe exists for deployments with a slow cold
 * start (first-time Prisma connection pool warm-up, a cold serverless
 * instance) where the orchestrator should wait patiently — with a longer
 * failure threshold/period than liveness would tolerate — before
 * `/api/health` and `/api/health/ready` are consulted at all. Once this
 * has returned 200 once, an orchestrator configured with `startupProbe`
 * (Kubernetes) or an equivalent stops calling it and switches to the
 * regular liveness/readiness cadence.
 *
 * Checks the same single hard dependency `/api/health/ready` does
 * (PostgreSQL reachability) for the same reason: every request this
 * application ever serves goes through Prisma, so "has startup
 * completed" and "can the database be reached" are, for this
 * application, the same question.
 */
export async function GET(request: NextRequest) {
  const requestId = resolveRequestId(request.headers.get(REQUEST_ID_HEADER));

  try {
    await prisma.$queryRaw`SELECT 1`;

    return NextResponse.json(
      { status: "started", timestamp: new Date().toISOString() },
      { status: 200, headers: { [REQUEST_ID_HEADER]: requestId } },
    );
  } catch (error) {
    logger.warn("startup_check_failed", { requestId, route: "/api/health/startup", error });

    return NextResponse.json(
      { status: "starting", timestamp: new Date().toISOString() },
      { status: 503, headers: { [REQUEST_ID_HEADER]: requestId } },
    );
  }
}
