import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { env } from "@/infrastructure/config/env";
import { isValidCronAuthHeader } from "@/infrastructure/auth/cron-auth";
import { logger } from "@/infrastructure/observability/logger";
import { createErrorReporter } from "@/infrastructure/observability/error-reporter-factory";
import { REQUEST_ID_HEADER, resolveRequestId } from "@/infrastructure/observability/request-id";
import { makeRetryPendingCloudinaryPurgesUseCase } from "@/application/use-cases/gdpr/compose";
import { withApiTracing } from "@/infrastructure/tracing/http-tracing";

/**
 * Module 94 — GDPR Cloudinary Purge Retry & Durable Erasure Completion:
 * the external-scheduler entry point for
 * `RetryPendingCloudinaryPurgesUseCase` — deliberate twin of
 * `src/app/api/cron/reconciliation-run/route.ts` (Module 90/92): identical
 * auth pattern (shared-secret bearer token, fail-closed when
 * `CRON_SECRET` is unset), identical request shape (Vercel Cron always
 * issues `GET`), identical "the use case owns concurrency/locking, this
 * route stays thin" contract (module brief rule 18: "The route must
 * authenticate the cron request; invoke the application use case; return
 * a concise result; not contain business logic").
 *
 * `vercel.json`'s `crons` entry points at this path on
 * `GDPR_CLOUDINARY_PURGE_SCHEDULE_CRON`'s cadence (every 30 minutes by
 * default — see that env var's own doc comment). Never returns any
 * personal data — only aggregate counts (claimed/succeeded/retried/
 * dead-lettered), the same "publicly-routable-if-unauthenticated surface
 * stays free of sensitive detail" reasoning `reconciliation-run/route.ts`
 * documents for its own response shape.
 */
export const GET = withApiTracing("/api/cron/gdpr-cloudinary-purge", async function GET(request: NextRequest) {
  const requestId = resolveRequestId(request.headers.get(REQUEST_ID_HEADER));

  if (!env.CRON_SECRET) {
    logger.error("gdpr_cloudinary_purge_cron_misconfigured", {
      requestId,
      route: "/api/cron/gdpr-cloudinary-purge",
      reason: "CRON_SECRET is not configured",
    });
    return NextResponse.json(
      { status: "error", message: "Cron endpoint is not configured." },
      { status: 503, headers: { [REQUEST_ID_HEADER]: requestId } },
    );
  }

  const authHeader = request.headers.get("authorization");
  if (!isValidCronAuthHeader(authHeader, env.CRON_SECRET)) {
    logger.warn("gdpr_cloudinary_purge_cron_unauthorized", {
      requestId,
      route: "/api/cron/gdpr-cloudinary-purge",
    });
    return NextResponse.json(
      { status: "error", message: "Unauthorized." },
      { status: 401, headers: { [REQUEST_ID_HEADER]: requestId } },
    );
  }

  try {
    const retryPendingCloudinaryPurges = makeRetryPendingCloudinaryPurgesUseCase();
    const result = await retryPendingCloudinaryPurges.execute(env.GDPR_CLOUDINARY_PURGE_RETRY_BATCH_SIZE);

    logger.info("gdpr_cloudinary_purge_cron_completed", {
      requestId,
      route: "/api/cron/gdpr-cloudinary-purge",
      outcome: result.outcome,
      claimed: result.claimed,
      succeeded: result.succeeded,
      retried: result.retried,
      deadLettered: result.deadLettered,
    });

    if (result.deadLettered > 0) {
      // Not a route failure (every claimed document was handled — this
      // is the module brief's own "expose failure ... never silently
      // discarded" requirement, rule 5/17), but an operator-actionable
      // signal: a message-level Sentry report, same convention
      // `reconciliation-run/route.ts` uses for a failed run.
      createErrorReporter().reportMessage("GDPR Cloudinary purge documents moved to DEAD_LETTER", {
        tags: { route: "/api/cron/gdpr-cloudinary-purge", source: "background-job" },
        extra: { requestId, deadLettered: result.deadLettered, claimed: result.claimed },
      });
    }

    return NextResponse.json(
      { status: "ok", timestamp: new Date().toISOString(), result },
      { status: 200, headers: { [REQUEST_ID_HEADER]: requestId } },
    );
  } catch (error) {
    logger.error("gdpr_cloudinary_purge_cron_failed", {
      requestId,
      route: "/api/cron/gdpr-cloudinary-purge",
      error,
    });
    createErrorReporter().reportException(error, {
      tags: { route: "/api/cron/gdpr-cloudinary-purge", source: "background-job" },
      extra: { requestId },
    });
    return NextResponse.json(
      { status: "error", message: "GDPR Cloudinary purge retry failed." },
      { status: 500, headers: { [REQUEST_ID_HEADER]: requestId } },
    );
  }
});
