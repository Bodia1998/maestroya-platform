import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { env } from "@/infrastructure/config/env";
import { isValidCronAuthHeader } from "@/infrastructure/auth/cron-auth";
import { logger } from "@/infrastructure/observability/logger";
import { createErrorReporter } from "@/infrastructure/observability/error-reporter-factory";
import { REQUEST_ID_HEADER, resolveRequestId } from "@/infrastructure/observability/request-id";
import { leadPrivacyRetentionBatchSize, makeRunLeadPrivacyRetentionUseCase } from "@/application/use-cases/lead-privacy/compose";
import { withApiTracing } from "@/infrastructure/tracing/http-tracing";

/**
 * Module 158 — the external-scheduler entry point for `RunLeadPrivacyRetentionUseCase` (LEAD_V1 erasure follow-through and, only
 * with an approved retention period configured, request-content minimization). Deliberate twin of
 * `api/cron/gdpr-cloudinary-purge/route.ts`: shared-secret bearer auth that fails closed when `CRON_SECRET` is unset, Vercel Cron
 * issues `GET`, the use case owns locking / bounding / idempotency, this route stays thin.
 *
 * `?dryRun=1` (authenticated like a real run) reports what WOULD change and writes nothing — the way to preview a rollout.
 *
 * The response and the logs carry COUNTS and fixed enums only — never a request text, an id, an email or any personal data.
 * A failed phase is surfaced (HTTP 500 + an operator-visible message report) instead of being swallowed.
 */
export const GET = withApiTracing("/api/cron/lead-privacy-retention", async function GET(request: NextRequest) {
  const requestId = resolveRequestId(request.headers.get(REQUEST_ID_HEADER));

  if (!env.CRON_SECRET) {
    logger.error("lead_privacy_retention_cron_misconfigured", {
      requestId,
      route: "/api/cron/lead-privacy-retention",
      reason: "CRON_SECRET is not configured",
    });
    return NextResponse.json(
      // i18n-ignore — machine/operator-facing (API response, header, SQL or log), not UI text
      { status: "error", message: "Cron endpoint is not configured." },
      { status: 503, headers: { [REQUEST_ID_HEADER]: requestId } },
    );
  }

  if (!isValidCronAuthHeader(request.headers.get("authorization"), env.CRON_SECRET)) {
    logger.warn("lead_privacy_retention_cron_unauthorized", { requestId, route: "/api/cron/lead-privacy-retention" });
    return NextResponse.json(
      // i18n-ignore — machine/operator-facing (API response, header, SQL or log), not UI text
      { status: "error", message: "Unauthorized." },
      { status: 401, headers: { [REQUEST_ID_HEADER]: requestId } },
    );
  }

  const dryRun = request.nextUrl.searchParams.get("dryRun") === "1";

  try {
    const result = await makeRunLeadPrivacyRetentionUseCase().execute({ batchSize: leadPrivacyRetentionBatchSize(), dryRun });

    if (result.outcome === "completed_with_failures") {
      // i18n-ignore — machine/operator-facing (API response, header, SQL or log), not UI text
      createErrorReporter().reportMessage("Lead privacy retention run completed with failed phases", {
        tags: { route: "/api/cron/lead-privacy-retention", source: "background-job" },
        extra: { requestId, failedPhases: result.failedPhases },
      });
      return NextResponse.json(
        // i18n-ignore — machine/operator-facing (API response, header, SQL or log), not UI text
        { status: "error", message: "Lead privacy retention completed with failures.", result },
        { status: 500, headers: { [REQUEST_ID_HEADER]: requestId } },
      );
    }

    return NextResponse.json(
      { status: "ok", timestamp: new Date().toISOString(), result },
      { status: 200, headers: { [REQUEST_ID_HEADER]: requestId } },
    );
  } catch (error) {
    logger.error("lead_privacy_retention_cron_failed", { requestId, route: "/api/cron/lead-privacy-retention", error });
    createErrorReporter().reportException(error, {
      tags: { route: "/api/cron/lead-privacy-retention", source: "background-job" },
      extra: { requestId },
    });
    return NextResponse.json(
      // i18n-ignore — machine/operator-facing (API response, header, SQL or log), not UI text
      { status: "error", message: "Lead privacy retention failed." },
      { status: 500, headers: { [REQUEST_ID_HEADER]: requestId } },
    );
  }
});
