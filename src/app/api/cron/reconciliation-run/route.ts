import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { env } from "@/infrastructure/config/env";
import { logger } from "@/infrastructure/observability/logger";
import { createErrorReporter } from "@/infrastructure/observability/error-reporter-factory";
import { REQUEST_ID_HEADER, resolveRequestId } from "@/infrastructure/observability/request-id";
import { makeStartReconciliationRunUseCase } from "@/application/use-cases/reconciliation/compose";
import { withApiTracing } from "@/infrastructure/tracing/http-tracing";

/**
 * Module 90 — Automated Reconciliation & Financial Alerting: the
 * external-scheduler entry point for the reconciliation engine, deliberate
 * twin of `src/app/api/cron/expire-workflows/route.ts` (Module 28) — same
 * auth pattern, same request shape, same reasoning for why it exists.
 *
 * `application/use-cases/reconciliation/compose.ts`'s
 * `registerScheduledReconciliationRun()` already gives a long-lived
 * container deployment (the `Dockerfile`/`docker-compose.prod.yml` path)
 * an in-process trigger via Module 45's `JobScheduler` — see that
 * function's own doc comment. This route is the *other* half of the same
 * dual-path convention `job-scheduler.ts` itself documents: on a
 * serverless/Vercel deployment, instances are not long-lived enough to
 * host an in-process timer reliably, so platform cron (`vercel.json`'s
 * `crons` entry, pointing at this route) is the right tool there instead.
 * Both paths call the exact same `StartReconciliationRunUseCase` — there
 * is only ever one reconciliation engine; this route adds no second one.
 *
 * ## Concurrency / idempotency
 * No extra locking here, deliberately — `StartReconciliationRunUseCase`
 * is already safe to invoke concurrently (a fresh `ReconciliationRun` row
 * every call; every discrepancy it finds is deduplicated one level down
 * by `ReconciliationDiscrepancyRepository.createOrTouch`'s fingerprint +
 * database-level partial unique index — see that use case's own doc
 * comment). A duplicate or overlapping invocation of this route (a
 * scheduler retry, or this route and the in-process scheduler both firing
 * around the same time) produces at most a second, redundant
 * `ReconciliationRun` row scanning the same window — never a duplicated
 * discrepancy, never conflicting financial state.
 *
 * Authorization: shared-secret bearer token, identical to
 * `expire-workflows/route.ts` — see that route's own doc comment for the
 * full reasoning (Vercel's `Authorization: Bearer $CRON_SECRET`
 * convention; refuses every request, rather than silently skipping the
 * check, when `CRON_SECRET` isn't configured).
 *
 * Deliberately a Route Handler (not a Server Action) and deliberately a
 * `GET` (Vercel Cron always issues GET requests) — no session/cookie auth
 * applies here, this endpoint is never meant to be called from the
 * browser, and it never returns discrepancy-level financial detail —
 * only the run's own summary counters — keeping this publicly-routable
 * (if unauthenticated) surface free of sensitive payment information.
 */
export const GET = withApiTracing("/api/cron/reconciliation-run", async function GET(request: NextRequest) {
  const requestId = resolveRequestId(request.headers.get(REQUEST_ID_HEADER));

  if (!env.CRON_SECRET) {
    logger.error("reconciliation_run_cron_misconfigured", {
      requestId,
      route: "/api/cron/reconciliation-run",
      reason: "CRON_SECRET is not configured",
    });
    return NextResponse.json(
      { status: "error", message: "Cron endpoint is not configured." },
      { status: 503, headers: { [REQUEST_ID_HEADER]: requestId } },
    );
  }

  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${env.CRON_SECRET}`) {
    logger.warn("reconciliation_run_cron_unauthorized", {
      requestId,
      route: "/api/cron/reconciliation-run",
    });
    return NextResponse.json(
      { status: "error", message: "Unauthorized." },
      { status: 401, headers: { [REQUEST_ID_HEADER]: requestId } },
    );
  }

  try {
    const startReconciliationRun = makeStartReconciliationRunUseCase();
    const summary = await startReconciliationRun.execute(
      { scope: env.RECONCILIATION_SCHEDULE_SCOPE, limit: env.RECONCILIATION_SCHEDULE_LIMIT },
      null,
    );

    logger.info("reconciliation_run_cron_completed", {
      requestId,
      route: "/api/cron/reconciliation-run",
      runId: summary.run.id,
      status: summary.run.status,
      discrepanciesCreated: summary.discrepanciesCreated,
      discrepanciesReconfirmed: summary.discrepanciesReconfirmed,
    });

    // The engine catches its own failures internally and persists a
    // FAILED ReconciliationRun rather than throwing (see
    // `StartReconciliationRunUseCase.execute`'s own doc comment) — this
    // route surfaces that as a 500 anyway (rather than a "successful"
    // 200) so an external scheduler's own failure/alerting treats a
    // failed engine run as the operational problem it is, without this
    // route ever having to re-decide what "failed" means.
    const status = summary.run.status === "FAILED" ? 500 : 200;
    if (status === 500) {
      createErrorReporter().reportMessage("Scheduled reconciliation run failed", {
        tags: { route: "/api/cron/reconciliation-run", source: "background-job" },
        extra: { requestId, runId: summary.run.id, errorMessage: summary.run.errorMessage },
      });
    }

    return NextResponse.json(
      {
        status: summary.run.status === "FAILED" ? "error" : "ok",
        timestamp: new Date().toISOString(),
        result: {
          runId: summary.run.id,
          runStatus: summary.run.status,
          recordsInspected: summary.run.recordsInspected,
          discrepanciesCreated: summary.discrepanciesCreated,
          discrepanciesReconfirmed: summary.discrepanciesReconfirmed,
        },
      },
      { status, headers: { [REQUEST_ID_HEADER]: requestId } },
    );
  } catch (error) {
    logger.error("reconciliation_run_cron_failed", {
      requestId,
      route: "/api/cron/reconciliation-run",
      error,
    });
    // Module 39 — Sentry + CI/CD Hardening: this branch is always an
    // unexpected failure of the route itself (auth already returned
    // above; the engine's own failures are represented as a 500 above
    // without throwing) — always reported, never just logged. Mirrors
    // `expire-workflows/route.ts`'s own catch block exactly.
    createErrorReporter().reportException(error, {
      tags: { route: "/api/cron/reconciliation-run", source: "background-job" },
      extra: { requestId },
    });
    return NextResponse.json(
      { status: "error", message: "Reconciliation run failed." },
      { status: 500, headers: { [REQUEST_ID_HEADER]: requestId } },
    );
  }
});
