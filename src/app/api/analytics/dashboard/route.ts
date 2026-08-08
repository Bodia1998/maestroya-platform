import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { getDashboardAnalyticsQuerySchema, type AnalyticsDashboardResponseDTO } from "@/application/dto/analytics-dashboard.dto";
import { getDashboardAnalyticsUseCase, getRebuildAnalyticsReadModelUseCase } from "@/infrastructure/analytics/compose";
import { ROLES, requireRole } from "@/infrastructure/auth/rbac";
import { toHttpErrorResponse } from "@/infrastructure/observability/http-error-response";
import { REQUEST_ID_HEADER, resolveRequestId } from "@/infrastructure/observability/request-id";
import { withApiTracing } from "@/infrastructure/tracing/http-tracing";

/**
 * Module 50 — Analytics Dashboard (CQRS Read Model).
 *
 * Thin controller: authenticate, parse, call the use case, shape the
 * response — zero business logic, matching the house style
 * `/api/realtime/channels/route.ts` and `/api/health/ready/route.ts`
 * establish for Route Handlers. `GET` is the CQRS **read side**
 * (`GetDashboardAnalyticsUseCase` — reads the cached read model, falling
 * back to a live recompute only on a miss); `POST` is the explicit,
 * operator-triggered **rebuild** (`RebuildAnalyticsReadModelUseCase`).
 * Both are admin-only — the figures here (revenue, dispute counts, ...)
 * are platform-operational data, never customer- or professional-facing.
 */
export const GET = withApiTracing("/api/analytics/dashboard", async function GET(request: NextRequest) {
  const requestId = resolveRequestId(request.headers.get(REQUEST_ID_HEADER));
  const headers = { [REQUEST_ID_HEADER]: requestId };

  try {
    await requireRole(ROLES.ADMIN, ROLES.SUPER_ADMIN);

    const query = getDashboardAnalyticsQuerySchema.parse({
      forceRefresh: request.nextUrl.searchParams.get("forceRefresh") ?? undefined,
    });

    const snapshot = await getDashboardAnalyticsUseCase().execute({ forceRefresh: query.forceRefresh });

    const body: AnalyticsDashboardResponseDTO = {
      data: snapshot.data,
      computedAt: snapshot.computedAt.toISOString(),
      source: snapshot.source,
      degraded: snapshot.degraded,
    };

    return NextResponse.json(body, { status: 200, headers });
  } catch (error) {
    return toHttpErrorResponse(error, { requestId, route: "/api/analytics/dashboard" });
  }
});

export const POST = withApiTracing("/api/analytics/dashboard", async function POST(request: NextRequest) {
  const requestId = resolveRequestId(request.headers.get(REQUEST_ID_HEADER));
  const headers = { [REQUEST_ID_HEADER]: requestId };

  try {
    await requireRole(ROLES.ADMIN, ROLES.SUPER_ADMIN);

    const report = await getRebuildAnalyticsReadModelUseCase().execute();

    return NextResponse.json(
      {
        startedAt: report.startedAt,
        completedAt: report.completedAt,
        durationMs: report.durationMs,
        degraded: report.snapshot.degraded,
      },
      { status: 200, headers },
    );
  } catch (error) {
    return toHttpErrorResponse(error, { requestId, route: "/api/analytics/dashboard" });
  }
});
