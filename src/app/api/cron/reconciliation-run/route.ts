import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { env } from "@/infrastructure/config/env";
import { logger } from "@/infrastructure/observability/logger";
import { createErrorReporter } from "@/infrastructure/observability/error-reporter-factory";
import { REQUEST_ID_HEADER, resolveRequestId } from "@/infrastructure/observability/request-id";
import { makeRunScheduledReconciliationSweepUseCase } from "@/application/use-cases/reconciliation/compose";
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
 * As of Module 92 — Reconciliation Full-Ledger Coverage & Advancing
 * Cursor — this route calls `makeRunScheduledReconciliationSweepUseCase()`,
 * not `StartReconciliationRunUseCase` directly. That use case wraps its
 * entire read-cursor / select-batch / reconcile / advance-cursor sequence
 * in the existing `DistributedLock` (Module 44), so a duplicate or
 * overlapping invocation of this route (a scheduler retry, or this route
 * and the in-process `JobScheduler` occurrence both firing around the
 * same time) either waits for no one — the loser returns immediately with
 * `outcome: "skipped_locked"`, still a 200, never blocking or retrying —
 * or, if it does acquire the lock, operates on whatever batch the cursor
 * currently points at, which by construction cannot be the same batch a
 * concurrent holder is still reconciling. The inner engine
 * (`StartReconciliationRunUseCase`) remains safe to invoke concurrently
 * in its own right on top of that (a fresh `ReconciliationRun` row every
 * call; every discrepancy it finds is deduplicated one level down by
 * `ReconciliationDiscrepancyRepository.createOrTouch`'s fingerprint +
 * database-level partial unique index — see that use case's own doc
 * comment) — never a duplicated discrepancy, never conflicting financial
 * state, never a skipped or double-processed cursor batch. See
 * `RunScheduledReconciliationSweepUseCase`'s own doc comment for the full
 * failure-safety/concurrency/full-cycle contract.
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
    const runScheduledReconciliationSweep = makeRunScheduledReconciliationSweepUseCase();
    const sweep = await runScheduledReconciliationSweep.execute({
      scope: env.RECONCILIATION_SCHEDULE_SCOPE,
      batchSize: env.RECONCILIATION_SCHEDULE_LIMIT,
    });

    logger.info("reconciliation_run_cron_completed", {
      requestId,
      route: "/api/cron/reconciliation-run",
      outcome: sweep.outcome,
      runId: sweep.run?.run.id ?? null,
      runStatus: sweep.run?.run.status ?? null,
      recordsSelected: sweep.recordsSelected,
      cursorBefore: sweep.cursorBefore,
      cursorAfter: sweep.cursorAfter,
      cycleNumber: sweep.cycleNumber,
      cycleCompleted: sweep.cycleCompleted,
      discrepanciesCreated: sweep.run?.discrepanciesCreated ?? 0,
      discrepanciesReconfirmed: sweep.run?.discrepanciesReconfirmed ?? 0,
    });

    // Module 92 — Reconciliation Full-Ledger Coverage & Advancing
    // Cursor: `RunScheduledReconciliationSweepUseCase` never throws for
    // a failed batch (see its own doc comment) — the same "surface an
    // engine failure as a 500, not a silent 200" contract this route
    // already had is preserved here by checking `outcome === "run_failed"`
    // instead of `summary.run.status === "FAILED"` directly.
    // `"skipped_locked"` (an overlapping invocation) and `"skipped_empty"`
    // (nothing eligible after the cursor right now — a genuine cycle
    // boundary or an empty ledger) are both expected, healthy outcomes,
    // never a 500.
    const status = sweep.outcome === "run_failed" ? 500 : 200;
    if (status === 500) {
      createErrorReporter().reportMessage("Scheduled reconciliation run failed", {
        tags: { route: "/api/cron/reconciliation-run", source: "background-job" },
        extra: { requestId, runId: sweep.run?.run.id ?? null, errorMessage: sweep.run?.run.errorMessage ?? null },
      });
    }

    return NextResponse.json(
      {
        status: sweep.outcome === "run_failed" ? "error" : "ok",
        timestamp: new Date().toISOString(),
        result: {
          outcome: sweep.outcome,
          runId: sweep.run?.run.id ?? null,
          runStatus: sweep.run?.run.status ?? null,
          recordsInspected: sweep.run?.run.recordsInspected ?? 0,
          discrepanciesCreated: sweep.run?.discrepanciesCreated ?? 0,
          discrepanciesReconfirmed: sweep.run?.discrepanciesReconfirmed ?? 0,
          cursor: {
            before: { createdAt: sweep.cursorBefore.createdAt?.toISOString() ?? null, jobId: sweep.cursorBefore.jobId },
            after: { createdAt: sweep.cursorAfter.createdAt?.toISOString() ?? null, jobId: sweep.cursorAfter.jobId },
            cycleNumber: sweep.cycleNumber,
            cycleCompleted: sweep.cycleCompleted,
          },
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
