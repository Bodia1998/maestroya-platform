import "server-only";

import { CompanyCreated } from "@/domain/events/company-created";
import { CompanyStatusChanged } from "@/domain/events/company-status-changed";
import { CompanyUpdated } from "@/domain/events/company-updated";
import { CompanyVerificationStatusChanged } from "@/domain/events/company-verification-status-changed";
import { ProfessionalCreated } from "@/domain/events/professional-created";
import { ProfessionalUpdated } from "@/domain/events/professional-updated";
import { ProfessionalVerificationStatusChanged } from "@/domain/events/professional-verification-status-changed";
import { ReviewCreated } from "@/domain/events/review-created";
import { ReviewDeleted } from "@/domain/events/review-deleted";
import { ReviewUpdated } from "@/domain/events/review-updated";
import { ServiceRequestUpdated } from "@/domain/events/service-request-updated";
import { EXPIRABLE_SERVICE_REQUEST_STATUSES } from "@/domain/services/service-request-expiration-rules";
import type { SearchIndexProvider } from "@/application/ports/search-index-provider";
import type { SearchIndexQueue } from "@/application/ports/search-index-queue";
import type { SearchObserver } from "@/application/ports/search-observer";
import { SearchDocumentProjector } from "@/application/services/search/search-document-projector";
import { SearchReadModelUseCase } from "@/application/use-cases/search/search-read-model.use-case";
import { BatchIndexSearchDocumentsUseCase } from "@/application/use-cases/search-indexing/batch-index-search-documents.use-case";
import { DeleteSearchDocumentUseCase } from "@/application/use-cases/search-indexing/delete-search-document.use-case";
import { EnqueueSearchIndexSubscriber } from "@/application/use-cases/search-indexing/enqueue-search-index.subscriber";
import { IndexSearchDocumentUseCase } from "@/application/use-cases/search-indexing/index-search-document.use-case";
import { RebuildSearchIndexUseCase } from "@/application/use-cases/search-indexing/rebuild-search-index.use-case";
import { ReindexReviewedProfileSubscriber } from "@/application/use-cases/search-indexing/reindex-reviewed-profile.subscriber";
import { env } from "@/infrastructure/config/env";
import { PrismaCompanyDiscoveryRepository } from "@/infrastructure/database/prisma/repositories/prisma-company-discovery-repository";
import { PrismaJobRepository } from "@/infrastructure/database/prisma/repositories/prisma-job-repository";
import { PrismaProfessionalDiscoveryRepository } from "@/infrastructure/database/prisma/repositories/prisma-professional-discovery-repository";
import { PrismaServiceRequestRepository } from "@/infrastructure/database/prisma/repositories/prisma-service-request-repository";
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
import {
  collectSearchEngineHealth,
  DISABLED_SEARCH_ENGINE_HEALTH,
  type SearchEngineHealthReport,
} from "@/infrastructure/search/search-health";
import { buildSearchIndexName, SEARCH_INDEX_VERSION } from "@/infrastructure/search/search-index-name";
import { createSearchIndexJobProcessor } from "@/infrastructure/search/search-index-job-processor";
import {
  SEARCH_INDEX_DEAD_LETTER_QUEUE_NAME,
  SEARCH_INDEX_QUEUE_NAME,
  searchIndexJobIdempotencyKey,
  type SearchIndexJobData,
} from "@/infrastructure/search/search-index-jobs";
import { SearchIndexQueueAdapter } from "@/infrastructure/search/search-index-queue-adapter";
import { createSearchObserver } from "@/infrastructure/search/search-observability";
import { createSearchProvider } from "@/infrastructure/search/search-provider-factory";
import { getSearchSyncState } from "@/infrastructure/search/search-sync-state";

/**
 * Module 47 — CQRS Search Engine (Roadmap Module 14).
 *
 * Composition root for the search read model — the same manual,
 * no-DI-container convention as every other `compose.ts` in this codebase
 * (`infrastructure/cache/compose.ts`, `infrastructure/jobs/compose.ts`,
 * `infrastructure/events/compose.ts`): module-level singletons, plain
 * exported factory functions, `__testing.reset()`, no reflection.
 *
 * This one file owns four things, and is the only place any of them
 * happen:
 *
 *  1. **The read side** — `getSearchReadModelUseCase()`, the CQRS query
 *     entry point a page or Server Action would call.
 *  2. **The write side** — the indexing use cases, the `search-index`
 *     queue, and the `Worker` that drains it (with dead-lettering,
 *     retries, and execution-time idempotency all *configured*, never
 *     reimplemented — every one of those mechanisms is Module 45's).
 *  3. **The subscriptions** — `eventBus.subscribe(...)` for every domain
 *     event that can change a searchable entity, registered at module
 *     load exactly as `infrastructure/events/compose.ts` documents each
 *     module should do for its own handlers.
 *  4. **Health** — `getSearchEngineHealth()`, consumed by
 *     `/api/health/ready`.
 *
 * ## Why the worker and subscriptions are lazy
 * Everything is built on first use rather than at import time, and
 * `registerSearchIndexSubscribers()` is idempotent. Two reasons: Next.js
 * imports modules during `next build` for analysis, where starting
 * workers or opening engine connections would be wrong (the same
 * reasoning behind `Worker`'s `autorun: false` default); and reads must
 * work even when indexing is switched off, so importing this file for
 * `getSearchReadModelUseCase()` must not drag in a worker.
 *
 * ## `SEARCH_INDEXING_ENABLED=false`
 * Skips subscriber registration and worker creation entirely. Reads keep
 * working against whatever is already indexed. This is the operator's
 * switch for "stop writing while I fix/rebuild the engine", and it is
 * deliberately independent of `SEARCH_PROVIDER`.
 */

function indexingEnabled(): boolean {
  // Opt-out, not opt-in: with the in-memory provider as the default,
  // indexing is free and local, and an index that silently never fills is
  // a far more confusing default than one that does.
  return env.SEARCH_INDEXING_ENABLED !== "false";
}

let provider: SearchIndexProvider | null = null;
let observer: SearchObserver | null = null;
let projector: SearchDocumentProjector | null = null;
let indexQueue: Queue<SearchIndexJobData> | null = null;
let deadLetterQueue: Queue<DeadLetterJobData> | null = null;
let queueAdapter: SearchIndexQueue | null = null;
let worker: Worker<SearchIndexJobData> | null = null;
let readModel: SearchReadModelUseCase | null = null;
let rebuild: RebuildSearchIndexUseCase | null = null;
let subscribed = false;

/** Repositories are constructed once, like every other composition root does. */
const professionalDiscovery = new PrismaProfessionalDiscoveryRepository();
const companyDiscovery = new PrismaCompanyDiscoveryRepository();
const serviceRequests = new PrismaServiceRequestRepository();
const jobs = new PrismaJobRepository();

export function getSearchProvider(): SearchIndexProvider {
  if (!provider) provider = createSearchProvider();
  return provider;
}

export function getSearchObserver(): SearchObserver {
  if (!observer) observer = createSearchObserver();
  return observer;
}

function getProjector(): SearchDocumentProjector {
  if (!projector) {
    projector = new SearchDocumentProjector({
      professionals: professionalDiscovery,
      companies: companyDiscovery,
      serviceRequests,
    });
  }
  return projector;
}

/**
 * The CQRS **read side**. Every caller shares one instance, which shares
 * one provider — with the in-memory provider that is not an optimization
 * but a correctness requirement (a second provider would be a second,
 * empty index).
 */
export function getSearchReadModelUseCase(): SearchReadModelUseCase {
  if (!readModel) readModel = new SearchReadModelUseCase(getSearchProvider(), getSearchObserver());
  return readModel;
}

/**
 * The full-rebuild entry point, exported for an operator/CLI/cron caller.
 * Safe to run at any time and safe to run twice — see the use case's own
 * doc comment on why it never empties the index first.
 */
export function getRebuildSearchIndexUseCase(): RebuildSearchIndexUseCase {
  if (!rebuild) {
    rebuild = new RebuildSearchIndexUseCase(
      getSearchProvider(),
      new BatchIndexSearchDocumentsUseCase(getSearchProvider(), getProjector(), getSearchObserver()),
      professionalDiscovery,
      companyDiscovery,
      getSearchObserver(),
    );
  }
  return rebuild;
}

/**
 * The queue every event subscriber enqueues into, plus — on first call —
 * the worker that drains it.
 *
 * The worker is configured with, and adds nothing to, Module 45's
 * machinery:
 *  - `attempts`/`backoff` come from `jobDefaults` + the adapter's job
 *    options (exponential from 1s, 20% jitter);
 *  - `deadLetterQueue` parks exhausted jobs with their full payload;
 *  - `idempotency.keyFor` is `searchIndexJobIdempotencyKey`, so a
 *    redelivered job is skipped rather than re-indexed (and a rebuild
 *    opts out entirely — see that function's doc comment).
 */
export function getSearchIndexQueue(): SearchIndexQueue {
  if (!queueAdapter) {
    indexQueue = createManagedQueue<SearchIndexJobData>(SEARCH_INDEX_QUEUE_NAME);
    deadLetterQueue = createManagedQueue<DeadLetterJobData>(SEARCH_INDEX_DEAD_LETTER_QUEUE_NAME);

    worker = new Worker<SearchIndexJobData>(
      SEARCH_INDEX_QUEUE_NAME,
      createSearchIndexJobProcessor({
        index: new IndexSearchDocumentUseCase(getSearchProvider(), getProjector(), getSearchObserver()),
        remove: new DeleteSearchDocumentUseCase(getSearchProvider(), getSearchObserver()),
        rebuild: getRebuildSearchIndexUseCase(),
      }),
      {
        store: createJobStore(),
        concurrency: jobDefaults.concurrency,
        deadLetterQueue,
        observer: getJobObserver(),
        idempotency: {
          store: createJobIdempotencyStore(),
          keyFor: (job) => searchIndexJobIdempotencyKey(job as never),
        },
      },
    );

    getBackgroundJobRuntime().registerWorker(worker);

    queueAdapter = new SearchIndexQueueAdapter(indexQueue, {
      attempts: jobDefaults.maxAttempts,
      backoff: { type: "exponential", delay: 1000, jitter: 0.2 },
    });
  }
  return queueAdapter;
}

/**
 * Registers this module's handlers against the shared `eventBus` — the
 * pattern `infrastructure/events/compose.ts` prescribes.
 *
 * Every subscriber here is enqueue-only: none of them holds a
 * `SearchIndexProvider`, so none of them can index inside the publishing
 * request, whichever `EventBus` implementation is active.
 *
 * Called from the bottom of this file at module load, and again
 * (harmlessly) by anything that imports this file later — the `subscribed`
 * flag makes double registration impossible, which matters because a
 * second registration would mean two jobs per event.
 */
export function registerSearchIndexSubscribers(): void {
  if (subscribed || !indexingEnabled()) return;
  subscribed = true;

  // Deliberately *not* `getSearchIndexQueue()`: registration happens at
  // module load, and building the queue eagerly there would create the
  // `search-index` queues (and the worker) in every process that merely
  // imports this file — including `next build` analysis and every test
  // that transitively imports a `compose.ts`. This one-line indirection
  // keeps the documented laziness honest: subscribers are registered
  // immediately, but the queue/worker are constructed on the first event
  // that actually needs to be indexed.
  const queue: SearchIndexQueue = { enqueue: (request) => getSearchIndexQueue().enqueue(request) };
  const searchObserver = getSearchObserver();

  eventBus.subscribe(
    ProfessionalCreated,
    new EnqueueSearchIndexSubscriber<ProfessionalCreated>(
      queue,
      (event) => ({ operation: "index", kind: "PROFESSIONAL", entityId: event.professionalId }),
      searchObserver,
    ),
  );
  eventBus.subscribe(
    ProfessionalUpdated,
    new EnqueueSearchIndexSubscriber<ProfessionalUpdated>(
      queue,
      (event) => ({ operation: "index", kind: "PROFESSIONAL", entityId: event.professionalId }),
      searchObserver,
    ),
  );

  // Verification changes `isVerified` — an indexed, filterable, and
  // rankable field — so the pre-existing Module 37 event is subscribed to
  // rather than a new one being invented for the same fact.
  eventBus.subscribe(
    ProfessionalVerificationStatusChanged,
    new EnqueueSearchIndexSubscriber<ProfessionalVerificationStatusChanged>(
      queue,
      (event) => ({ operation: "index", kind: "PROFESSIONAL", entityId: event.professionalProfileId }),
      searchObserver,
    ),
  );

  eventBus.subscribe(
    CompanyCreated,
    new EnqueueSearchIndexSubscriber<CompanyCreated>(
      queue,
      (event) => ({ operation: "index", kind: "COMPANY", entityId: event.companyId }),
      searchObserver,
    ),
  );
  eventBus.subscribe(
    CompanyUpdated,
    new EnqueueSearchIndexSubscriber<CompanyUpdated>(
      queue,
      (event) => ({ operation: "index", kind: "COMPANY", entityId: event.companyId }),
      searchObserver,
    ),
  );
  eventBus.subscribe(
    CompanyStatusChanged,
    new EnqueueSearchIndexSubscriber<CompanyStatusChanged>(
      queue,
      (event) => ({ operation: "index", kind: "COMPANY", entityId: event.companyId }),
      searchObserver,
    ),
  );
  eventBus.subscribe(
    CompanyVerificationStatusChanged,
    new EnqueueSearchIndexSubscriber<CompanyVerificationStatusChanged>(
      queue,
      (event) => ({ operation: "index", kind: "COMPANY", entityId: event.companyProfileId }),
      searchObserver,
    ),
  );

  // A request that has left the open states is *deleted* from the index
  // rather than re-projected. Deciding that here — from a field the event
  // already carries — saves the worker a read whose only possible outcome
  // was a removal.
  eventBus.subscribe(
    ServiceRequestUpdated,
    new EnqueueSearchIndexSubscriber<ServiceRequestUpdated>(
      queue,
      (event) => ({
        operation: EXPIRABLE_SERVICE_REQUEST_STATUSES.includes(
          event.status as (typeof EXPIRABLE_SERVICE_REQUEST_STATUSES)[number],
        )
          ? "index"
          : "delete",
        kind: "SERVICE_REQUEST",
        entityId: event.serviceRequestId,
      }),
      searchObserver,
    ),
  );

  // Reviews move a profile's rating/review count, both indexed. See the
  // subscriber's doc comment for why this one resolves the reviewee via a
  // Job lookup instead of reading it off the event.
  const reviewSubscriber = new ReindexReviewedProfileSubscriber(jobs, queue, searchObserver);
  eventBus.subscribe(ReviewCreated, reviewSubscriber);
  eventBus.subscribe(ReviewUpdated, reviewSubscriber);
  eventBus.subscribe(ReviewDeleted, reviewSubscriber);
}

export async function getSearchEngineHealth(): Promise<SearchEngineHealthReport> {
  if (!indexingEnabled() && !provider) return DISABLED_SEARCH_ENGINE_HEALTH;

  const queues: { name: string; getCounts(): Promise<QueueCounts> }[] = [];
  if (indexQueue) queues.push(indexQueue);
  if (deadLetterQueue) queues.push(deadLetterQueue);

  return collectSearchEngineHealth({
    provider: getSearchProvider(),
    indexName: buildSearchIndexName(),
    indexVersion: SEARCH_INDEX_VERSION,
    indexingEnabled: indexingEnabled(),
    queues,
    sync: getSearchSyncState().snapshot(),
  });
}

/** Exposed for tests only — drops every singleton so the next call rebuilds. */
export const __testing = {
  reset(): void {
    provider = null;
    observer = null;
    projector = null;
    indexQueue = null;
    deadLetterQueue = null;
    queueAdapter = null;
    worker = null;
    readModel = null;
    rebuild = null;
    subscribed = false;
    getSearchSyncState().reset();
  },
  get worker(): Worker<SearchIndexJobData> | null {
    return worker;
  },
};

// Module-load registration — the convention every event-subscribing
// module in this codebase follows (see `infrastructure/events/compose.ts`).
// `instrumentation.ts` imports this file at boot so registration is
// deterministic rather than dependent on which route runs first.
registerSearchIndexSubscribers();
