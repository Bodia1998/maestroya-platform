import "server-only";

import { eventBus } from "@/infrastructure/events/compose";
import { createFailureReporter } from "@/infrastructure/observability/failure-reporter-factory";
import { PrismaReconciliationRunRepository } from "@/infrastructure/database/prisma/repositories/prisma-reconciliation-run-repository";
import { PrismaReconciliationDiscrepancyRepository } from "@/infrastructure/database/prisma/repositories/prisma-reconciliation-discrepancy-repository";
import { PrismaReconciliationDataSource } from "@/infrastructure/database/prisma/repositories/prisma-reconciliation-data-source";
import { PrismaReconciliationScheduleCursorRepository } from "@/infrastructure/database/prisma/repositories/prisma-reconciliation-schedule-cursor-repository";
import { PrismaAdminAuditLogRepository } from "@/infrastructure/database/prisma/repositories/prisma-admin-audit-log-repository";
import { NullProviderReconciliationAdapter } from "@/infrastructure/payments/null-provider-reconciliation-adapter";
import { StripeProviderReconciliationAdapter } from "@/infrastructure/payments/stripe/stripe-provider-reconciliation-adapter";
import { createDistributedLock } from "@/infrastructure/locking/lock-service-factory";
import { StartReconciliationRunUseCase } from "./start-reconciliation-run.use-case";
import { RunScheduledReconciliationSweepUseCase } from "./run-scheduled-reconciliation-sweep.use-case";
import { GetReconciliationRunUseCase } from "./get-reconciliation-run.use-case";
import { ListDiscrepanciesForRunUseCase } from "./list-discrepancies-for-run.use-case";
import { ListUnresolvedHighSeverityDiscrepanciesUseCase } from "./list-unresolved-high-severity-discrepancies.use-case";
import { ResolveDiscrepancyUseCase } from "./resolve-discrepancy.use-case";
import { GetFinancialEntitySnapshotUseCase } from "./get-financial-entity-snapshot.use-case";
import { ListReconciliationRunsUseCase } from "./list-reconciliation-runs.use-case";
import { ListDiscrepanciesUseCase } from "./list-discrepancies.use-case";
import { GetReconciliationOverviewUseCase } from "./get-reconciliation-overview.use-case";
import { GetReconciliationRunSeverityBreakdownUseCase } from "./get-reconciliation-run-severity-breakdown.use-case";
import { GetDiscrepancyByIdUseCase } from "./get-discrepancy-by-id.use-case";
import {
  RecordDiscrepancyResolutionAuditLogSubscriber,
  RecordReconciliationRunAuditLogSubscriber,
} from "./record-reconciliation-audit-log.subscriber";
import { ReconciliationRunStarted } from "@/domain/events/reconciliation-run-started";
import { ReconciliationRunCompleted } from "@/domain/events/reconciliation-run-completed";
import { ReconciliationRunFailed } from "@/domain/events/reconciliation-run-failed";
import { DiscrepancyResolved } from "@/domain/events/discrepancy-resolved";
// Module 90 — Automated Reconciliation & Financial Alerting.
import { AlertOnCriticalDiscrepancySubscriber } from "./alert-on-critical-discrepancy.subscriber";
import { DiscrepancyDetected } from "@/domain/events/discrepancy-detected";
import { createErrorReporter } from "@/infrastructure/observability/error-reporter-factory";
import { env } from "@/infrastructure/config/env";
import { createManagedQueue, getBackgroundJobRuntime, getJobObserver, jobDefaults } from "@/infrastructure/jobs/compose";
import { createJobIdempotencyStore } from "@/infrastructure/jobs/job-idempotency-store";
import { createJobStore } from "@/infrastructure/jobs/job-store-factory";
import type { Queue } from "@/infrastructure/jobs/queue";
import type { DeadLetterJobData } from "@/infrastructure/jobs/worker";
import { Worker } from "@/infrastructure/jobs/worker";
import { createReconciliationRunJobProcessor } from "@/infrastructure/reconciliation/reconciliation-job-processor";
import {
  RECONCILIATION_RUN_DEAD_LETTER_QUEUE_NAME,
  RECONCILIATION_RUN_QUEUE_NAME,
  reconciliationRunJobIdempotencyKey,
  type ReconciliationRunJobData,
} from "@/infrastructure/reconciliation/reconciliation-jobs";

/**
 * Module 80 — Financial Reconciliation & Observability.
 *
 * Composition root — same manual-wiring convention as every other
 * `compose.ts` in this codebase (see `invoicing/compose.ts`'s own doc
 * comment).
 *
 * ## Provider reconciliation binding
 * `NullProviderReconciliationAdapter` is the default binding, exactly
 * mirroring `infrastructure/payments/compose.ts`'s own original
 * `NullPaymentGateway` -> `StripePaymentGatewayAdapter` migration path
 * (see that file's doc comment: "Module 73 is the only file that changes
 * to go from Null... to a real implementation"). Switching to
 * `StripeProviderReconciliationAdapter` (backed by the same shared
 * `stripe` SDK client singleton every other Stripe adapter already uses)
 * is a one-line change here — see
 * `MODULE_80_IMPLEMENTATION_REPORT.md`, "Remaining risks," for why this
 * has been left on the Null binding rather than switched by this
 * implementation itself (no live Stripe verification was performed in
 * this environment).
 */
const runs = new PrismaReconciliationRunRepository();
const discrepancies = new PrismaReconciliationDiscrepancyRepository();
const dataSource = new PrismaReconciliationDataSource();
// Module 92 — Reconciliation Full-Ledger Coverage & Advancing Cursor.
const scheduleCursor = new PrismaReconciliationScheduleCursorRepository();
const auditLog = new PrismaAdminAuditLogRepository();
const provider = new NullProviderReconciliationAdapter();
const failureReporter = createFailureReporter();
// Module 90 — the general-purpose Sentry/console error reporter used by
// the critical-discrepancy alert path (see that subscriber's own doc
// comment on why this is `ErrorReporter`, not `FailureReporter`).
const errorReporter = createErrorReporter();

export function makeStartReconciliationRunUseCase(): StartReconciliationRunUseCase {
  return new StartReconciliationRunUseCase(dataSource, runs, discrepancies, provider, eventBus, failureReporter);
}

/**
 * Module 92 — Reconciliation Full-Ledger Coverage & Advancing Cursor.
 *
 * The composed use case both the Vercel Cron route
 * (`api/cron/reconciliation-run/route.ts`) and the in-process
 * `JobScheduler` occurrence (`createReconciliationRunJobProcessor` below)
 * call — replacing their previous direct call to
 * `makeStartReconciliationRunUseCase()` with `since: null` (see that
 * function's own doc comment for why the old call was bounded to only
 * the most-recently-active window). Reuses `createDistributedLock()` —
 * the same Module 44 lock factory `payments/compose.ts` already uses for
 * `ExecuteProfessionalPayoutUseCase` — no second locking mechanism.
 *
 * Admin-triggered manual runs (`admin/reconciliation/actions.ts`) keep
 * calling `makeStartReconciliationRunUseCase()` directly with their own
 * `since`/`limit` — untouched by this module.
 */
export function makeRunScheduledReconciliationSweepUseCase(): RunScheduledReconciliationSweepUseCase {
  return new RunScheduledReconciliationSweepUseCase(dataSource, scheduleCursor, makeStartReconciliationRunUseCase(), createDistributedLock());
}

export function makeGetReconciliationRunUseCase(): GetReconciliationRunUseCase {
  return new GetReconciliationRunUseCase(runs);
}

export function makeListDiscrepanciesForRunUseCase(): ListDiscrepanciesForRunUseCase {
  return new ListDiscrepanciesForRunUseCase(discrepancies);
}

export function makeListUnresolvedHighSeverityDiscrepanciesUseCase(): ListUnresolvedHighSeverityDiscrepanciesUseCase {
  return new ListUnresolvedHighSeverityDiscrepanciesUseCase(discrepancies);
}

export function makeResolveDiscrepancyUseCase(): ResolveDiscrepancyUseCase {
  return new ResolveDiscrepancyUseCase(discrepancies, eventBus, failureReporter);
}

export function makeGetFinancialEntitySnapshotUseCase(): GetFinancialEntitySnapshotUseCase {
  return new GetFinancialEntitySnapshotUseCase(dataSource);
}

// Module 81 — Reconciliation Admin Dashboard & Operations: the three
// read-only use cases the admin UI needs that Module 80 hadn't composed a
// factory for yet (the runs list, the filterable discrepancies table, and
// the overview aggregate) — same manual-wiring convention as every
// factory above, no new dependency introduced.
export function makeListReconciliationRunsUseCase(): ListReconciliationRunsUseCase {
  return new ListReconciliationRunsUseCase(runs);
}

export function makeListDiscrepanciesUseCase(): ListDiscrepanciesUseCase {
  return new ListDiscrepanciesUseCase(discrepancies);
}

export function makeGetReconciliationOverviewUseCase(): GetReconciliationOverviewUseCase {
  return new GetReconciliationOverviewUseCase(runs, discrepancies);
}

export function makeGetReconciliationRunSeverityBreakdownUseCase(): GetReconciliationRunSeverityBreakdownUseCase {
  return new GetReconciliationRunSeverityBreakdownUseCase(discrepancies);
}

export function makeGetDiscrepancyByIdUseCase(): GetDiscrepancyByIdUseCase {
  return new GetDiscrepancyByIdUseCase(discrepancies);
}

/**
 * Module 81 — Reconciliation Admin Dashboard & Operations: a human-facing
 * label for which `ProviderFinancialReconciliationPort` binding is
 * currently active (see this file's own top-of-file doc comment on the
 * Null -> Stripe migration path), surfaced on the admin overview so an
 * operator can tell whether "0 provider discrepancies" means "nothing
 * wrong" or "provider reconciliation isn't wired to a real gateway yet."
 * Not a use case — there is no domain/application logic here, only a
 * static read of which infrastructure class this composition root
 * instantiated, so a dedicated use case would add a layer without adding
 * a rule; `actions.ts` reads this constant directly, same as any other
 * composition-root constant.
 */
export const RECONCILIATION_PROVIDER_BINDING_LABEL =
  provider instanceof StripeProviderReconciliationAdapter ? "Stripe" : "Null adapter (not connected to a live provider)";

const runAuditLogSubscriber = new RecordReconciliationRunAuditLogSubscriber(auditLog);
eventBus.subscribe(ReconciliationRunStarted, runAuditLogSubscriber);
eventBus.subscribe(ReconciliationRunCompleted, runAuditLogSubscriber);
eventBus.subscribe(ReconciliationRunFailed, runAuditLogSubscriber);
eventBus.subscribe(DiscrepancyResolved, new RecordDiscrepancyResolutionAuditLogSubscriber(auditLog));
// Module 90 — Automated Reconciliation & Financial Alerting: turns a
// newly-detected CRITICAL discrepancy into an operational alert — see
// `AlertOnCriticalDiscrepancySubscriber`'s own doc comment for the full
// dedup/failure-isolation contract.
eventBus.subscribe(DiscrepancyDetected, new AlertOnCriticalDiscrepancySubscriber(errorReporter, auditLog));

// ============================================================================
// Module 90 — Scheduled reconciliation trigger
// ============================================================================
//
// The automated counterpart to the admin-triggered
// `StartReconciliationRunUseCase` above: a periodic `JobScheduler`
// occurrence (Module 45) that calls the exact same use case with no new
// engine, no second reconciliation implementation, and no new financial
// write path — see `reconciliation-job-processor.ts`'s own doc comment.
//
// Lazy by design, mirroring `infrastructure/analytics/compose.ts`'s
// `getAnalyticsRefreshQueue()`/`registerScheduledAnalyticsRefresh()`
// split exactly: importing this module (including transitively, during
// `next build`'s module analysis) must never open a queue or start a
// worker, and `JobScheduler.register()` needs an actual `Queue` object
// synchronously, so the schedule itself is only registered by an explicit
// call from `instrumentation.ts`, immediately before `startBackgroundJobs()`.

function reconciliationAutomationEnabled(): boolean {
  return env.RECONCILIATION_AUTOMATION_ENABLED !== "false";
}

let reconciliationRunQueue: Queue<ReconciliationRunJobData> | null = null;
let reconciliationRunDeadLetterQueue: Queue<DeadLetterJobData> | null = null;
let reconciliationRunWorker: Worker<ReconciliationRunJobData> | null = null;
let reconciliationScheduled = false;

/**
 * The queue the scheduler enqueues into, plus — on first call — the
 * worker that drains it. `attempts`/`backoff` from `jobDefaults`
 * (exponential from 1s, 20% jitter — absorbs a transient DB blip without
 * every scheduled occurrence retrying in lockstep), a dead-letter queue
 * for a persistently failing engine, and
 * `reconciliationRunJobIdempotencyKey` opting every job out of
 * execution-time de-duplication (see that function's own doc comment for
 * why that is safe here).
 */
function getReconciliationRunQueue(): Queue<ReconciliationRunJobData> {
  if (!reconciliationRunQueue) {
    reconciliationRunQueue = createManagedQueue<ReconciliationRunJobData>(RECONCILIATION_RUN_QUEUE_NAME);
    reconciliationRunDeadLetterQueue = createManagedQueue<DeadLetterJobData>(RECONCILIATION_RUN_DEAD_LETTER_QUEUE_NAME);

    reconciliationRunWorker = new Worker<ReconciliationRunJobData>(
      RECONCILIATION_RUN_QUEUE_NAME,
      createReconciliationRunJobProcessor(makeRunScheduledReconciliationSweepUseCase()),
      {
        store: createJobStore(),
        // One reconciliation run at a time — the engine itself is safe to
        // run concurrently (see `StartReconciliationRunUseCase`'s own doc
        // comment), but there is no benefit to two scheduled scans racing
        // each other against the same bounded Job window, only wasted
        // database load.
        concurrency: 1,
        deadLetterQueue: reconciliationRunDeadLetterQueue,
        observer: getJobObserver(),
        idempotency: {
          store: createJobIdempotencyStore(),
          keyFor: (job) => reconciliationRunJobIdempotencyKey(job as never),
        },
      },
    );

    getBackgroundJobRuntime().registerWorker(reconciliationRunWorker);
  }
  return reconciliationRunQueue;
}

/**
 * Registers the periodic reconciliation run against the shared
 * `JobScheduler`. Duplicate/concurrent scheduling across multiple
 * application instances is handled entirely by that scheduler's own
 * deterministic occurrence id (`repeat:<name>:<occurrenceMs>` — see
 * `job-scheduler.ts`'s own doc comment): two instances that both decide
 * "the 6-hour mark is due" enqueue the *same* job id, and the underlying
 * `JobStore`'s de-duplication means exactly one job — and therefore
 * exactly one `ReconciliationRun` — is created for that occurrence. No
 * additional `DistributedLock` is layered on top, for the same reason
 * `JobScheduler` itself already documents.
 *
 * Called explicitly from `instrumentation.ts`, never as a side effect of
 * import — see this section's own top-of-block doc comment.
 */
export function registerScheduledReconciliationRun(): void {
  if (reconciliationScheduled || !reconciliationAutomationEnabled()) return;
  reconciliationScheduled = true;

  const queue = getReconciliationRunQueue();

  getBackgroundJobRuntime().scheduler.register<ReconciliationRunJobData>({
    name: "financial-reconciliation-run",
    queue,
    jobName: "reconciliation.run",
    data: {
      scope: env.RECONCILIATION_SCHEDULE_SCOPE,
      limit: env.RECONCILIATION_SCHEDULE_LIMIT,
      reason: "scheduled",
    },
    repeat: { pattern: env.RECONCILIATION_SCHEDULE_CRON },
    jobOptions: { attempts: jobDefaults.maxAttempts, backoff: { type: "exponential", delay: 5000, jitter: 0.2 } },
  });
}

/** Exposed for tests only — drops every scheduling singleton so the next call rebuilds. */
export const __testing = {
  reset(): void {
    reconciliationRunQueue = null;
    reconciliationRunDeadLetterQueue = null;
    reconciliationRunWorker = null;
    reconciliationScheduled = false;
  },
  get worker(): Worker<ReconciliationRunJobData> | null {
    return reconciliationRunWorker;
  },
};
