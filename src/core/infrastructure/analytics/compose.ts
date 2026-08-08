import "server-only";

import { CompanyCreated } from "@/domain/events/company-created";
import { CompanyInvitationStatusChanged } from "@/domain/events/company-invitation-status-changed";
import { CompanyMembershipChanged } from "@/domain/events/company-membership-changed";
import { CompanyStatusChanged } from "@/domain/events/company-status-changed";
import { CompanyUpdated } from "@/domain/events/company-updated";
import { CompanyVerificationStatusChanged } from "@/domain/events/company-verification-status-changed";
import { DisputeCreated } from "@/domain/events/dispute-created";
import { DisputeStatusChanged } from "@/domain/events/dispute-status-changed";
import { PaymentCaptured } from "@/domain/events/payment-captured";
import { ProfessionalCreated } from "@/domain/events/professional-created";
import { ProfessionalUpdated } from "@/domain/events/professional-updated";
import { ProfessionalVerificationStatusChanged } from "@/domain/events/professional-verification-status-changed";
import { ReviewCreated } from "@/domain/events/review-created";
import { ReviewDeleted } from "@/domain/events/review-deleted";
import { ReviewUpdated } from "@/domain/events/review-updated";
import { ServiceRequestUpdated } from "@/domain/events/service-request-updated";
import { SupportTicketStatusChanged } from "@/domain/events/support-ticket-status-changed";
import type { AnalyticsObserver } from "@/application/ports/analytics-observer";
import type { AnalyticsReadModelStore } from "@/application/ports/analytics-read-model-store";
import type { AnalyticsRefreshQueue } from "@/application/ports/analytics-refresh-queue";
import { AnalyticsDashboardAssembler } from "@/application/services/analytics/analytics-dashboard-assembler";
import { EnqueueAnalyticsRefreshSubscriber } from "@/application/use-cases/analytics-dashboard/enqueue-analytics-refresh.subscriber";
import { GetDashboardAnalyticsUseCase } from "@/application/use-cases/analytics-dashboard/get-dashboard-analytics.use-case";
import { RebuildAnalyticsReadModelUseCase } from "@/application/use-cases/analytics-dashboard/rebuild-analytics-read-model.use-case";
import { RefreshAnalyticsReadModelUseCase } from "@/application/use-cases/analytics-dashboard/refresh-analytics-read-model.use-case";
import {
  makeGetPlatformAnalyticsSummaryUseCase,
  makeGetPlatformFunnelUseCase,
} from "@/application/use-cases/analytics/compose";
import { PublishToChannelUseCase } from "@/application/use-cases/realtime/publish-to-channel.use-case";
import { env } from "@/infrastructure/config/env";
import {
  collectAnalyticsHealth,
  DISABLED_ANALYTICS_HEALTH,
  type AnalyticsHealthReport,
} from "@/infrastructure/analytics/analytics-health";
import { createAnalyticsObserver } from "@/infrastructure/analytics/analytics-observability";
import { createAnalyticsRefreshJobProcessor } from "@/infrastructure/analytics/analytics-refresh-job-processor";
import {
  ANALYTICS_REFRESH_DEAD_LETTER_QUEUE_NAME,
  ANALYTICS_REFRESH_QUEUE_NAME,
  analyticsRefreshJobIdempotencyKey,
  type AnalyticsRefreshJobData,
} from "@/infrastructure/analytics/analytics-refresh-jobs";
import { AnalyticsRefreshQueueAdapter } from "@/infrastructure/analytics/analytics-refresh-queue-adapter";
import { CacheAnalyticsReadModelStore } from "@/infrastructure/analytics/cache-analytics-read-model-store";
import { getCacheNamespace } from "@/infrastructure/cache/compose";
import { PrismaDisputeAnalyticsRepository } from "@/infrastructure/database/prisma/repositories/prisma-dispute-analytics-repository";
import { PrismaSupportTicketAnalyticsRepository } from "@/infrastructure/database/prisma/repositories/prisma-support-ticket-analytics-repository";
import { eventBus } from "@/infrastructure/events/compose";
import {
  createManagedQueue,
  getBackgroundJobRuntime,
  getJobObserver,
  jobDefaults,
} from "@/infrastructure/jobs/compose";
import { createJobIdempotencyStore } from "@/infrastructure/jobs/job-idempotency-store";
import { createJobStore } from "@/infrastructure/jobs/job-store-factory";
import type { QueueCounts } from "@/infrastructure/jobs/job-types";
import type { Queue } from "@/infrastructure/jobs/queue";
import type { DeadLetterJobData } from "@/infrastructure/jobs/worker";
import { Worker } from "@/infrastructure/jobs/worker";
import { getRealtimeHealth, realtimeHub } from "@/infrastructure/realtime/compose";
import { getSearchProvider } from "@/infrastructure/search/compose";

/**
 * Module 50 — Analytics Dashboard (CQRS Read Model).
 *
 * Composition root — the same manual, no-DI-container convention as
 * every other `compose.ts` in this codebase, structurally closest to
 * `infrastructure/search/compose.ts` (Module 47): a read side, a write
 * side (queue + worker, built on Module 45), event subscriptions, a
 * scheduled periodic refresh (Module 45's `JobScheduler`), and a health
 * report consumed by `/api/health/ready`.
 *
 * ## Why the worker, scheduler registration, and subscriptions are lazy
 * Exactly `infrastructure/search/compose.ts`'s own reasoning: Next.js
 * imports modules during `next build` for analysis, where starting a
 * worker/scheduler or opening a queue would be wrong; and
 * `GetDashboardAnalyticsUseCase` must keep working (via its own live
 * fallback) even in a process that never enables the refresh pipeline.
 * `registerAnalyticsRefreshSubscribers()` is idempotent, mirroring
 * `registerSearchIndexSubscribers()`.
 *
 * ## `ANALYTICS_REFRESH_ENABLED=false`
 * Skips subscriber registration, worker construction, and the scheduled
 * refresh entirely. Reads still work — every call to
 * `GetDashboardAnalyticsUseCase.execute()` falls through to a live
 * recompute on a cache miss regardless of this flag, exactly as it would
 * on the very first request after a cold start.
 */

function refreshEnabled(): boolean {
  return env.ANALYTICS_REFRESH_ENABLED !== "false";
}

let observer: AnalyticsObserver | null = null;
let store: AnalyticsReadModelStore | null = null;
let assembler: AnalyticsDashboardAssembler | null = null;
let publishToChannel: PublishToChannelUseCase | null = null;
let dashboardUseCase: GetDashboardAnalyticsUseCase | null = null;
let refreshUseCase: RefreshAnalyticsReadModelUseCase | null = null;
let rebuildUseCase: RebuildAnalyticsReadModelUseCase | null = null;
let refreshQueue: Queue<AnalyticsRefreshJobData> | null = null;
let deadLetterQueue: Queue<DeadLetterJobData> | null = null;
let queueAdapter: AnalyticsRefreshQueue | null = null;
let worker: Worker<AnalyticsRefreshJobData> | null = null;
let subscribed = false;
let scheduled = false;

const disputeAnalytics = new PrismaDisputeAnalyticsRepository();
const supportTicketAnalytics = new PrismaSupportTicketAnalyticsRepository();

export function getAnalyticsObserver(): AnalyticsObserver {
  if (!observer) observer = createAnalyticsObserver();
  return observer;
}

export function getAnalyticsReadModelStore(): AnalyticsReadModelStore {
  if (!store) store = new CacheAnalyticsReadModelStore(getCacheNamespace("analytics-dashboard"));
  return store;
}

function getAssembler(): AnalyticsDashboardAssembler {
  if (!assembler) {
    assembler = new AnalyticsDashboardAssembler(
      makeGetPlatformAnalyticsSummaryUseCase(),
      makeGetPlatformFunnelUseCase(),
      disputeAnalytics,
      supportTicketAnalytics,
      getSearchProvider(),
      () => {
        const health = getRealtimeHealth();
        return {
          activeConnections: health.activeConnections,
          activeChannels: health.activeChannels,
          onlineUsers: health.onlineUsers,
        };
      },
    );
  }
  return assembler;
}

function getPublishToChannel(): PublishToChannelUseCase {
  if (!publishToChannel) publishToChannel = new PublishToChannelUseCase(realtimeHub);
  return publishToChannel;
}

/** The CQRS **read side** — the entry point a route/Server Action calls. */
export function getDashboardAnalyticsUseCase(): GetDashboardAnalyticsUseCase {
  if (!dashboardUseCase) {
    dashboardUseCase = new GetDashboardAnalyticsUseCase(
      getAnalyticsReadModelStore(),
      getAssembler(),
      env.ANALYTICS_CACHE_TTL_MS,
      getAnalyticsObserver(),
    );
  }
  return dashboardUseCase;
}

/** The coalesced, event/scheduled-triggered recompute — used by the worker. */
export function getRefreshAnalyticsReadModelUseCase(): RefreshAnalyticsReadModelUseCase {
  if (!refreshUseCase) {
    refreshUseCase = new RefreshAnalyticsReadModelUseCase(
      getAssembler(),
      getAnalyticsReadModelStore(),
      getPublishToChannel(),
      env.ANALYTICS_CACHE_TTL_MS,
      getAnalyticsObserver(),
    );
  }
  return refreshUseCase;
}

/** The explicit, never-coalesced operator/API-triggered rebuild. */
export function getRebuildAnalyticsReadModelUseCase(): RebuildAnalyticsReadModelUseCase {
  if (!rebuildUseCase) rebuildUseCase = new RebuildAnalyticsReadModelUseCase(getRefreshAnalyticsReadModelUseCase());
  return rebuildUseCase;
}

/**
 * The queue every event subscriber enqueues into, plus — on first call —
 * the worker that drains it. Mirrors `getSearchIndexQueue()` exactly:
 * `attempts`/`backoff` from `jobDefaults` (exponential from 1s, 20%
 * jitter), a dead-letter queue for exhausted jobs, and
 * `analyticsRefreshJobIdempotencyKey` for execution-time de-duplication
 * (a no-op opt-out here — see that function's own doc comment).
 */
export function getAnalyticsRefreshQueue(): AnalyticsRefreshQueue {
  if (!queueAdapter) {
    refreshQueue = createManagedQueue<AnalyticsRefreshJobData>(ANALYTICS_REFRESH_QUEUE_NAME);
    deadLetterQueue = createManagedQueue<DeadLetterJobData>(ANALYTICS_REFRESH_DEAD_LETTER_QUEUE_NAME);

    worker = new Worker<AnalyticsRefreshJobData>(
      ANALYTICS_REFRESH_QUEUE_NAME,
      createAnalyticsRefreshJobProcessor({
        refresh: getRefreshAnalyticsReadModelUseCase(),
        rebuild: getRebuildAnalyticsReadModelUseCase(),
      }),
      {
        store: createJobStore(),
        concurrency: jobDefaults.concurrency,
        deadLetterQueue,
        observer: getJobObserver(),
        idempotency: {
          store: createJobIdempotencyStore(),
          keyFor: (job) => analyticsRefreshJobIdempotencyKey(job as never),
        },
      },
    );

    getBackgroundJobRuntime().registerWorker(worker);

    queueAdapter = new AnalyticsRefreshQueueAdapter(refreshQueue, {
      attempts: jobDefaults.maxAttempts,
      backoff: { type: "exponential", delay: 1000, jitter: 0.2 },
    });
  }
  return queueAdapter;
}

/**
 * Registers this module's handlers against the shared `eventBus` — every
 * subscriber is enqueue-only (see `EnqueueAnalyticsRefreshSubscriber`'s
 * own doc comment), so none of them can run the multi-query recompute
 * inside the publishing request, whichever `EventBus` implementation is
 * active.
 *
 * ## Which events, and why exactly these
 * Every event listed here changes a number the dashboard reports and
 * already exists in `src/core/domain/events/` — see docs/
 * MODULE_50_ANALYTICS_DASHBOARD.md's event-driven/scheduled table for the
 * KPI areas with *no* existing event (bookings/jobs, quotes, service
 * requests' own volume, notifications, SMS), which instead rely entirely
 * on the periodic scheduled refresh below.
 */
export function registerAnalyticsRefreshSubscribers(): void {
  if (subscribed || !refreshEnabled()) return;
  subscribed = true;

  // Deliberately *not* `getAnalyticsRefreshQueue()` — see
  // `registerSearchIndexSubscribers()`'s identical comment for why this
  // one-line indirection keeps queue/worker construction lazy while
  // registration itself stays eager, at module load.
  const queue: AnalyticsRefreshQueue = { enqueue: (request) => getAnalyticsRefreshQueue().enqueue(request) };
  const analyticsObserver = getAnalyticsObserver();

  eventBus.subscribe(
    ProfessionalCreated,
    new EnqueueAnalyticsRefreshSubscriber(queue, "professional.created", analyticsObserver),
  );
  eventBus.subscribe(
    ProfessionalUpdated,
    new EnqueueAnalyticsRefreshSubscriber(queue, "professional.updated", analyticsObserver),
  );
  eventBus.subscribe(
    ProfessionalVerificationStatusChanged,
    new EnqueueAnalyticsRefreshSubscriber(queue, "professional-verification.status-changed", analyticsObserver),
  );
  eventBus.subscribe(CompanyCreated, new EnqueueAnalyticsRefreshSubscriber(queue, "company.created", analyticsObserver));
  eventBus.subscribe(CompanyUpdated, new EnqueueAnalyticsRefreshSubscriber(queue, "company.updated", analyticsObserver));
  eventBus.subscribe(
    CompanyStatusChanged,
    new EnqueueAnalyticsRefreshSubscriber(queue, "company.status-changed", analyticsObserver),
  );
  eventBus.subscribe(
    CompanyVerificationStatusChanged,
    new EnqueueAnalyticsRefreshSubscriber(queue, "company-verification.status-changed", analyticsObserver),
  );
  eventBus.subscribe(
    CompanyInvitationStatusChanged,
    new EnqueueAnalyticsRefreshSubscriber(queue, "company-invitation.status-changed", analyticsObserver),
  );
  eventBus.subscribe(
    CompanyMembershipChanged,
    new EnqueueAnalyticsRefreshSubscriber(queue, "company-membership.changed", analyticsObserver),
  );
  eventBus.subscribe(ReviewCreated, new EnqueueAnalyticsRefreshSubscriber(queue, "review.created", analyticsObserver));
  eventBus.subscribe(ReviewUpdated, new EnqueueAnalyticsRefreshSubscriber(queue, "review.updated", analyticsObserver));
  eventBus.subscribe(ReviewDeleted, new EnqueueAnalyticsRefreshSubscriber(queue, "review.deleted", analyticsObserver));
  eventBus.subscribe(DisputeCreated, new EnqueueAnalyticsRefreshSubscriber(queue, "dispute.created", analyticsObserver));
  eventBus.subscribe(
    DisputeStatusChanged,
    new EnqueueAnalyticsRefreshSubscriber(queue, "dispute.status-changed", analyticsObserver),
  );
  eventBus.subscribe(
    SupportTicketStatusChanged,
    new EnqueueAnalyticsRefreshSubscriber(queue, "support-ticket.status-changed", analyticsObserver),
  );
  eventBus.subscribe(PaymentCaptured, new EnqueueAnalyticsRefreshSubscriber(queue, "payment.captured", analyticsObserver));
  eventBus.subscribe(
    ServiceRequestUpdated,
    new EnqueueAnalyticsRefreshSubscriber(queue, "service_request.updated", analyticsObserver),
  );
}

/**
 * The periodic backstop (Module 45's `JobScheduler`) — recomputes the
 * dashboard on a fixed interval regardless of events, covering every KPI
 * area with no domain event today (bookings/jobs, quotes/service-request
 * volume, notifications, SMS — see docs/MODULE_50_ANALYTICS_DASHBOARD.md).
 * Registered against the *same* shared scheduler
 * `getBackgroundJobRuntime().scheduler` already owns, so it starts/stops
 * with every other scheduled job in the process and needs no timer of its
 * own.
 *
 * ## Why this call is *not* at module-load time, unlike subscriber registration
 * `JobScheduler.register()` needs an actual `Queue` object synchronously
 * — unlike `AnalyticsRefreshQueue`, there is no lazy indirection possible
 * the way `registerAnalyticsRefreshSubscribers()` uses for enqueuing, and
 * `BackgroundJobRuntime.start()` only starts the scheduler's timer if at
 * least one schedule is already registered *at that moment* (see
 * `infrastructure/jobs/compose.ts`'s own `start()`). Building the queue
 * (and therefore the worker) merely from importing this file — including
 * transitively, during `next build`'s module analysis — is exactly what
 * `infrastructure/search/compose.ts` avoids and this module follows the
 * same discipline for. The correct, single place to call this is
 * therefore `instrumentation.ts`, explicitly, immediately before
 * `startBackgroundJobs()` — the same real-boot-only timing
 * `startBackgroundJobs()` itself already requires.
 */
export function registerScheduledAnalyticsRefresh(): void {
  if (scheduled || !refreshEnabled()) return;
  scheduled = true;

  // Building the queue/worker here (rather than importing `Queue` and
  // constructing a second one) is deliberate — there must be exactly one
  // `analytics-refresh` `Queue` instance for `Queue.add`'s de-duplication
  // (§ `analytics-refresh-jobs.ts`) to actually de-duplicate against.
  getAnalyticsRefreshQueue();

  getBackgroundJobRuntime().scheduler.register<AnalyticsRefreshJobData>({
    name: "analytics-dashboard-refresh",
    queue: refreshQueue!,
    jobName: "analytics.refresh",
    data: { operation: "refresh", reason: "scheduled" },
    repeat: { every: env.ANALYTICS_SCHEDULED_REFRESH_INTERVAL_MS },
  });
}

export async function getAnalyticsHealth(): Promise<AnalyticsHealthReport> {
  if (!refreshEnabled() && !refreshQueue) return DISABLED_ANALYTICS_HEALTH;

  const queues: { name: string; getCounts(): Promise<QueueCounts> }[] = [];
  if (refreshQueue) queues.push(refreshQueue);
  if (deadLetterQueue) queues.push(deadLetterQueue);

  const snapshot = await getAnalyticsReadModelStore()
    .get()
    .catch(() => null);

  return collectAnalyticsHealth({
    refreshEnabled: refreshEnabled(),
    snapshot,
    queues,
  });
}

/** Exposed for tests only — drops every singleton so the next call rebuilds. */
export const __testing = {
  reset(): void {
    observer = null;
    store = null;
    assembler = null;
    publishToChannel = null;
    dashboardUseCase = null;
    refreshUseCase = null;
    rebuildUseCase = null;
    refreshQueue = null;
    deadLetterQueue = null;
    queueAdapter = null;
    worker = null;
    subscribed = false;
    scheduled = false;
  },
  get worker(): Worker<AnalyticsRefreshJobData> | null {
    return worker;
  },
};

// Module-load registration — the convention every event-subscribing
// module in this codebase follows (see `infrastructure/events/compose.ts`).
// `instrumentation.ts` imports this file at boot so registration is
// deterministic rather than dependent on which route runs first. Cheap
// and side-effect-free (no queue/worker is built here) — see
// `EnqueueAnalyticsRefreshSubscriber`'s lazy `queue` indirection above.
// `registerScheduledAnalyticsRefresh()` is deliberately **not** called
// here — see that function's own doc comment for why it must instead be
// called explicitly from `instrumentation.ts`, immediately before
// `startBackgroundJobs()`.
registerAnalyticsRefreshSubscribers();
