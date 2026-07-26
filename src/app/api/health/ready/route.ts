import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { prisma } from "@/infrastructure/database/prisma/client";
import { logger } from "@/infrastructure/observability/logger";
import { REQUEST_ID_HEADER, resolveRequestId } from "@/infrastructure/observability/request-id";

/**
 * Readiness check (Module 25 — Production Infrastructure).
 *
 * Answers "can this instance safely receive production traffic right
 * now?" — checks the one dependency this application cannot function
 * without: PostgreSQL. Every read/write path in the app goes through
 * Prisma, so a database that's unreachable means every meaningful
 * request would fail anyway.
 *
 * Deliberately does *not* also check Cloudinary, Stripe, or email
 * delivery: those are optional/degradable dependencies (an upload
 * failing, a card not charging, or a transactional email not sending are
 * all handled — or handleable — as isolated failures within their own
 * flows) and marking the *entire instance* unready because a
 * third-party API is briefly slow would cause unnecessary failover/
 * restarts for a problem that isn't actually this instance's fault. See
 * docs/MODULE_25_PRODUCTION_INFRASTRUCTURE.md, "Health & readiness" for
 * the full reasoning.
 *
 * Returns 503 (not 500) on failure — the conventional status for "the
 * server is currently unable to handle the request", which is exactly
 * what a load balancer/orchestrator readiness probe is checking for.
 */
export async function GET(request: NextRequest) {
  const requestId = resolveRequestId(request.headers.get(REQUEST_ID_HEADER));

  try {
    await prisma.$queryRaw`SELECT 1`;

    return NextResponse.json(
      {
        status: "ok",
        timestamp: new Date().toISOString(),
        checks: { database: "ok" },
      },
      { status: 200, headers: { [REQUEST_ID_HEADER]: requestId } },
    );
  } catch (error) {
    logger.error("readiness_check_failed", {
      requestId,
      route: "/api/health/ready",
      error,
    });

    return NextResponse.json(
      {
        status: "error",
        timestamp: new Date().toISOString(),
        checks: { database: "error" },
      },
      { status: 503, headers: { [REQUEST_ID_HEADER]: requestId } },
    );
  }
}
