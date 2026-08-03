import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { env } from "@/infrastructure/config/env";
import { logger } from "@/infrastructure/observability/logger";
import { REQUEST_ID_HEADER, resolveRequestId } from "@/infrastructure/observability/request-id";
import { makeRunWorkflowExpirationsUseCase } from "@/application/use-cases/workflow-expiration/compose";

/**
 * Module 28 — Workflow Completion: the single HTTP entry point for the
 * daily expiration sweep (ServiceRequest/Quote/ProfessionalVerification/
 * CompanyVerification -> EXPIRED — see
 * docs/MODULE_28_WORKFLOW_COMPLETION.md). Invoked by Vercel Cron per the
 * schedule in vercel.json's `crons` array (`"0 3 * * *"` — daily at 03:00
 * UTC, a low-traffic hour for this Spain-focused marketplace).
 *
 * Authorization: shared-secret bearer token, the standard Vercel Cron
 * pattern — Vercel automatically sends `Authorization: Bearer
 * $CRON_SECRET` for requests it triggers from vercel.json's `crons` config
 * (see https://vercel.com/docs/cron-jobs/manage-cron-jobs#securing-cron-jobs).
 * `CRON_SECRET` is optional at the env-schema level (see env.ts) so
 * environments that never configure scheduled cron aren't forced to set
 * it, but that means this route must itself refuse every request when the
 * secret isn't configured — never silently skip the check and accept
 * unauthenticated requests. A missing/mismatched secret always yields the
 * same generic 401/503 either way, never a distinguishable error that
 * would help a caller guess the correct value.
 *
 * Deliberately a Route Handler (not a Server Action) and deliberately a
 * `GET` (Vercel Cron always issues GET requests) — no session/cookie
 * auth applies here at all, this endpoint is never meant to be called from
 * the browser.
 */
export async function GET(request: NextRequest) {
  const requestId = resolveRequestId(request.headers.get(REQUEST_ID_HEADER));

  if (!env.CRON_SECRET) {
    logger.error("workflow_expiration_cron_misconfigured", {
      requestId,
      route: "/api/cron/expire-workflows",
      reason: "CRON_SECRET is not configured",
    });
    return NextResponse.json(
      { status: "error", message: "Cron endpoint is not configured." },
      { status: 503, headers: { [REQUEST_ID_HEADER]: requestId } },
    );
  }

  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${env.CRON_SECRET}`) {
    logger.warn("workflow_expiration_cron_unauthorized", {
      requestId,
      route: "/api/cron/expire-workflows",
    });
    return NextResponse.json(
      { status: "error", message: "Unauthorized." },
      { status: 401, headers: { [REQUEST_ID_HEADER]: requestId } },
    );
  }

  try {
    const runWorkflowExpirations = makeRunWorkflowExpirationsUseCase();
    const result = await runWorkflowExpirations.execute(new Date());

    logger.info("workflow_expiration_cron_completed", {
      requestId,
      route: "/api/cron/expire-workflows",
      totalExpired: result.totalExpired,
    });

    return NextResponse.json(
      { status: "ok", timestamp: new Date().toISOString(), result },
      { status: 200, headers: { [REQUEST_ID_HEADER]: requestId } },
    );
  } catch (error) {
    logger.error("workflow_expiration_cron_failed", {
      requestId,
      route: "/api/cron/expire-workflows",
      error,
    });
    return NextResponse.json(
      { status: "error", message: "Workflow expiration run failed." },
      { status: 500, headers: { [REQUEST_ID_HEADER]: requestId } },
    );
  }
}
