import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { REQUEST_ID_HEADER, resolveRequestId } from "@/infrastructure/observability/request-id";

/**
 * Liveness check (Module 25 — Production Infrastructure).
 *
 * Answers only "is this application process alive and able to handle an
 * HTTP request at all?" — deliberately has zero dependencies (no
 * database, no external service) so it can never report "down" because
 * of a problem elsewhere in the system. That distinction matters for a
 * container orchestrator or platform health check: a liveness probe
 * failing means "restart/replace this instance", which is the wrong
 * response to "the database is briefly unreachable" — that's what
 * `/api/health/ready` (the readiness probe, checking the database) is
 * for. Previously this single endpoint did both jobs (checked the
 * database); it's now split so a transient DB blip can't trigger
 * unnecessary instance restarts.
 *
 * `middleware.ts`'s matcher excludes `/api/**` (see its own comment), so
 * request-ID resolution happens directly in this route rather than
 * relying on middleware having already injected it.
 */
export async function GET(request: NextRequest) {
  const requestId = resolveRequestId(request.headers.get(REQUEST_ID_HEADER));

  return NextResponse.json(
    { status: "ok", timestamp: new Date().toISOString() },
    { status: 200, headers: { [REQUEST_ID_HEADER]: requestId } },
  );
}
