# Module 47 — CQRS Search Engine (Roadmap Module 14)

## 1. Goal

Give the platform a dedicated, technology-agnostic search read model — full-text, filtered, ranked, paginated, typo-tolerant, autocomplete-ready — without ever making Meilisearch, Typesense, or any search engine the source of truth, and without touching Module 19's existing Postgres-backed directory search. The write model (Prisma/Postgres) remains authoritative; the search index is a derived, disposable, eventually-consistent projection of it, maintained entirely by background workers reacting to domain events introduced by Modules 34/45.

## 2. Architecture

### 2.1 Layering

```
domain/entities/
  search-document.ts            (SearchDocument — the read model's stored shape; buildSearchDocumentId)

domain/events/
  professional-created.ts / professional-updated.ts
  company-created.ts / company-updated.ts
  service-request-updated.ts    (new lifecycle events this module added — see §4)

application/ports/
  search-index-provider.ts      (SearchIndexProvider — the provider-agnostic engine seam)
  search-index-queue.ts         (SearchIndexQueue — "request indexing", no queue/engine knowledge)
  search-observer.ts             (SearchObserver + nullSearchObserver)
  null-event-bus.ts              (NullEventBus — safe default for use cases that gained an EventBus param)

application/services/
  events/publish-domain-event.ts (publish-and-report-EventDispatchError, extracted from Modules 37/41's own pattern)
  search/search-document-mapper.ts     (pure write-model-record -> SearchDocument functions)
  search/search-document-projector.ts  (reads one entity from the write model, returns SearchDocument | null)

application/use-cases/search-indexing/
  index-search-document.use-case.ts       (incremental indexing)
  delete-search-document.use-case.ts      (unconditional delete-from-index)
  batch-index-search-documents.use-case.ts (batch indexing)
  rebuild-search-index.use-case.ts         (full, safe rebuild)
  enqueue-search-index.subscriber.ts       (generic event -> enqueue bridge)
  reindex-reviewed-profile.subscriber.ts   (review events -> reviewed profile's re-index)

application/use-cases/search/
  search-read-model.use-case.ts  (the CQRS query side)

application/dto/
  search-read-model.dto.ts       (searchReadModelSchema)

infrastructure/search/
  providers/in-memory-search-provider.ts   (full, real ranking/fuzzy/geo implementation)
  providers/meilisearch-search-provider.ts (SearchIndexProvider over Meilisearch)
  providers/typesense-search-provider.ts   (SearchIndexProvider over Typesense)
  search-provider-factory.ts     (env-driven provider selection, memoized)
  search-index-name.ts           (index name + version)
  search-index-jobs.ts           (job vocabulary, job id / idempotency key derivation)
  search-index-queue-adapter.ts  (SearchIndexQueue over a Module 45 Queue)
  search-index-job-processor.ts  (Worker's JobProcessor — routes a job to the right use case)
  search-observability.ts        (SearchObserver over logger + Sentry)
  search-sync-state.ts           (per-process "last successful sync" state)
  search-health.ts               (SearchEngineHealthReport shape + collectSearchEngineHealth)
  compose.ts                     (composition root: read side, write side, subscriptions, health)
```

Application code — the indexing use cases, the read-model use case, the event subscribers — depends only on `SearchIndexProvider`/`SearchIndexQueue`/`SearchObserver`. It never imports `meilisearch`, `typesense`, or a Module 45 `Queue`/`Worker` type directly. Only `infrastructure/search/` is allowed to know any of that exists, mirroring exactly how `CacheProvider` (Module 46) and `JobStore` (Module 45) keep their technology out of the application layer.

### 2.2 Relationship to Module 19's `SearchDirectoryUseCase`

This module is additive, not a replacement. Module 19's `SearchDirectoryUseCase` remains the production directory-search pipeline: it queries Postgres through `ProfessionalDiscoveryRepository`/`CompanyDiscoveryRepository` and ranks candidates in-process with the domain ranking engine — strongly consistent, and entirely adequate at the platform's current size. `SearchReadModelUseCase` (§2.1) asks the same underlying question of a different store: filtering, scoring, and sorting move into the search engine itself, trading strong consistency for O(1) round trips as the corpus grows and unlocking typo tolerance/autocomplete the ranking-engine approach can't give cheaply. The two are deliberately independent — no shared code path, no shared types beyond the read-only `SearchDocumentKind` — so a future migration from one to the other is a page-level routing decision, not a rewrite of either.

### 2.3 Read model vs. query response

`SearchDocument` (the *stored projection*, indexed) and `SearchResult`/`ProfessionalSearchResult`/`CompanySearchResult` (Module 19's *query response*, computed per-request) are deliberately separate types even though they overlap heavily. `SearchResult` carries `rankingReasons` and a privacy-fuzzed `mapPoint`, both computed at query time by the domain ranking engine — properties of a *response*, not of the entity. `SearchDocument` carries everything the engine needs to filter/sort/rank without a second lookup: the free-text blob, category ids, city/province/coordinates, and the rating/review/recency signals. Its fields are chosen so filtering and sorting happen inside the engine, which is the entire performance argument for having a search engine at all.

## 3. CQRS design

**Write side** — completely unchanged. Every existing use case (`CreateProfessionalUseCase`, `UpdateCompanyUseCase`, `UpdateServiceRequestUseCase`, ...) still writes to Postgres via Prisma exactly as before. The only addition is that five of them now also publish a domain event announcing what changed (§4) — a side effect appended after the write already succeeded, using the exact "publish, report a dispatch failure, never fail the write" contract Modules 37/41 established.

**Read side** — `SearchReadModelUseCase.execute(query)` asks the configured `SearchIndexProvider` directly; it never touches Postgres. It is not wired into a live page/route in this module (that is a follow-up integration, once a real engine is provisioned in production) — it is fully built, tested, and demonstrates the intended CQRS query entry point.

**Consistency** — eventually consistent, by design. A professional's index document reflects whatever the last successfully processed indexing job wrote, which can lag the write model by however long the event → queue → worker pipeline takes to drain (typically milliseconds to a few seconds under normal load). Nothing in this module makes the write path wait for indexing to complete.

## 4. Event flow

```
Use case writes to Postgres
        │
        ▼
publishDomainEvent(eventBus, SomeEvent)      (Module 34's shared eventBus; never fails the write)
        │
        ▼
EnqueueSearchIndexSubscriber.handle(event)   (or ReindexReviewedProfileSubscriber for review events)
        │  — extracts {operation, kind, entityId}, enqueues, never indexes
        ▼
SearchIndexQueue.enqueue(request)            (application-layer port)
        │
        ▼
SearchIndexQueueAdapter                      (infrastructure — adapts onto a Module 45 Queue)
        │
        ▼
Module 45 Queue  →  Module 45 Worker         (search-index-job-processor.ts routes the job)
        │
        ▼
IndexSearchDocumentUseCase / DeleteSearchDocumentUseCase / RebuildSearchIndexUseCase
        │
        ▼
SearchIndexProvider.indexDocument(s) / deleteDocument / deleteByFilter
```

### 4.1 New domain events

The codebase already had review/dispute/verification/status-change events, but nothing announced a professional or company being created, or a plain profile edit — the two entities customer-facing search is actually about. This module added:

- `ProfessionalCreated` / `ProfessionalUpdated` (published from `CreateProfessionalUseCase`, `UpdateProfessionalUseCase`, `DeactivateProfessionalUseCase`, `UpdateProfessionalServicesUseCase`)
- `CompanyCreated` / `CompanyUpdated` (published from `CreateCompanyUseCase`, `UpdateCompanyUseCase`, `UpdateCompanyServicesUseCase`)
- `ServiceRequestUpdated` (published from `UpdateServiceRequestUseCase`, carrying the post-update status so the subscriber can decide index-vs-remove without a read)

Every payload is deliberately just an id (plus, for `*Updated`, a short non-authoritative `reason` label used only for observability). A search-index job always re-reads the current row from the write model when it runs — never trusts a snapshot captured at publish time — which is what makes redelivery, retries, and out-of-order delivery all converge on the same correct result.

Existing events are reused where they already carry the relevant fact: `ProfessionalVerificationStatusChanged`, `CompanyStatusChanged`, and `CompanyVerificationStatusChanged` all change an indexed, filterable field (`isVerified`, discovery eligibility), so the subscribers listen to those directly instead of inventing redundant events. `ReviewCreated`/`ReviewUpdated`/`ReviewDeleted` (Module 41) drive `ReindexReviewedProfileSubscriber`, which resolves the reviewed profile via a `Job` lookup (those events predate this module and carry `jobId`, not a `ProfessionalProfile.id`) rather than widening three existing, already-subscribed-to event contracts.

### 4.2 Why indexing never happens in a request handler

The platform's default `SynchronousEventBus` dispatches every subscriber inline, inside the publisher's own call stack — so a subscriber that called `SearchIndexProvider.indexDocument(...)` directly would put a network round trip to Meilisearch/Typesense on the critical path of, say, creating a professional, and would fail or slow that request whenever the engine was unavailable. Every subscriber in this module is therefore enqueue-only: `EnqueueSearchIndexSubscriber` and `ReindexReviewedProfileSubscriber` hold a `SearchIndexQueue`, never a `SearchIndexProvider` — they are structurally incapable of indexing directly, not just documented not to. The actual provider call happens later, inside a Module 45 `Worker`, where retries and dead-lettering already exist.

## 5. Read model lifecycle

`SearchDocumentProjector.project(kind, entityId)` is the single place "does this entity belong in the index, and what does its document look like" is decided, for all three indexing paths (single, batch, rebuild). It returns `null` when the entity is missing, deactivated, or no longer eligible, and a `SearchDocument` otherwise. `IndexSearchDocumentUseCase` turns that `null` directly into a delete: there is no separate "handle deactivation" code path, because the discovery repositories' own ACTIVE-only eligibility rule already decides it. Eligibility is never re-derived: professionals/companies are eligible exactly when Module 19's discovery repositories return them; service requests are eligible exactly while in the open states `EXPIRABLE_SERVICE_REQUEST_STATUSES` names (`PUBLISHED`/`QUOTED`).

Document ids are deterministic (`buildSearchDocumentId(kind, entityId)`), which is what makes every write idempotent by construction — indexing the same entity twice overwrites one document, never creates two. Every document also carries `indexedAt`, the timestamp of the *projection*, distinct from the entity's own `createdAt` — the mechanism the safe-rebuild strategy (§6) is built on.

## 6. Index synchronization

- **Incremental** (`IndexSearchDocumentUseCase`) — the overwhelming majority of jobs: one entity, re-projected and upserted (or removed, if no longer eligible).
- **Batch** (`BatchIndexSearchDocumentsUseCase`) — many entities of one kind in a single provider round trip; the building block `RebuildSearchIndexUseCase` is made of, since the cost of indexing is dominated by the network round trip, not the projection.
- **Delete** (`DeleteSearchDocumentUseCase`) — unconditional removal, for callers that already know an entity must not be searchable and have nothing left to re-read (a hard delete, a GDPR erasure). Deleting an absent document is a no-op everywhere, never an error — the property that makes a duplicate/racing delete safe to re-run.
- **Rebuild** (`RebuildSearchIndexUseCase`) — re-projects the entire read model from the write model, in batches, for `PROFESSIONAL` and `COMPANY` (the two kinds with an unfiltered `searchCandidates({})` read already available on their discovery repositories). It is the operational backstop that makes every other guarantee in this module affordable: a lost job, a dead-lettered event, a corrupted index, or a `SearchDocument` schema change are all recoverable by running it, rather than by coupling the incremental path transactionally to the write model.

  **Safe by construction — never an empty-index window.** The index is never cleared first. Every eligible entity is re-indexed first (each write stamps a fresh `indexedAt`); only then is `deleteByFilter({ kind, indexedBefore: startedAt })` issued, removing exactly the documents this pass did *not* touch. Search keeps serving complete results throughout the rebuild, and running it twice in a row (or after a partially-failed run) converges on the same state rather than compounding drift.

  `SERVICE_REQUEST` is intentionally not rebuildable today — that would require a new "every open request" read on `ServiceRequestRepository`, an interface this module does not touch. Service-request documents are instead incrementally self-healing: every open request is re-projected on its next edit and removed the moment it leaves the open states.

`SEARCH_INDEX_VERSION` (`search-index-name.ts`) is a code constant, not an env var — a property of the `SearchDocument` schema a given build writes, not of the deployment. Bumping it in the same commit that changes the document shape makes the new build write to a brand-new, empty index while the previous build's index (and any in-flight rollback target) is left completely untouched — the same reasoning behind `CacheKeyBuilder`'s `v<N>` segment (Module 46), applied at index granularity.

## 7. Failure recovery

Retry, exponential backoff, dead-lettering, and execution-time idempotency are **entirely Module 45's** — this module configures them, it does not reimplement them:

- **Enqueue-time de-duplication** — `SearchIndexQueueAdapter` derives the job id from `searchIndexJobId()`, keyed on the *domain event id* (not just the entity). A redelivered event collapses into the same job id and is silently coalesced by `Queue.add`'s own `SET NX` semantics; a genuinely later edit is a new event with a new id and always gets its own job. Rebuild/manual requests (no event id) key on `operation:kind:entityId:"manual"`, coalescing concurrent manual triggers for the same entity instead.
- **Execution-time de-duplication** — the `Worker`'s `idempotency` option uses `searchIndexJobIdempotencyKey()`, the same key shape, covering the case enqueue-time dedup cannot: a job that ran successfully but whose completion was lost. Rebuild jobs opt out (`null`) — a rebuild is idempotent by construction and is precisely the operation an operator may need to run twice.
- **Retry with backoff** — configured via `Queue.add`'s `JobOptions` (`SearchIndexQueueAdapter`'s constructor argument): exponential from 1s with 20% jitter, the same policy the queued event bus already uses, so a batch of documents that all failed on the same engine outage does not retry in lockstep and re-DDoS it on recovery.
- **Dead-lettering** — `search-index-dead-letter`, a second Module 45 `Queue`, parks a job's full payload once attempts are exhausted, exactly like every other dead-letter queue in this codebase.
- **Errors are thrown, never swallowed, inside the write path.** `IndexSearchDocumentUseCase`, `DeleteSearchDocumentUseCase`, `BatchIndexSearchDocumentsUseCase`, and `RebuildSearchIndexUseCase` all let a provider failure propagate — catching it here would silently convert a failed index into a "successful" job and leave the read model permanently stale with no trace. `search-index-job-processor.ts` likewise lets every exception escape, which is the contract the `Worker` is built around.

**Graceful degradation is the read side's entire failure strategy.** `SearchReadModelUseCase.execute()` catches a provider failure and returns `{ items: [], total: 0, degraded: true }` rather than propagating — a customer sees "search is temporarily unavailable" (a UI decision keyed on `degraded`), never a 500. The write model is the source of truth and the application is fully functional without search: customers can still browse, quote, book, and pay. `/api/health/ready`'s `checks.searchEngine` follows the identical reasoning `checks.cache`/`checks.queue`/`checks.cachingLayer` already established (Modules 44–46) — reported for operational visibility only, never allowed to change the route's overall status or HTTP code, because the search index is derived data whose worst case is staleness, always repairable by a rebuild.

`SEARCH_INDEXING_ENABLED=false` is the operator's independent kill switch for the *write* side: it unsubscribes every event handler and skips building the queue/worker entirely, while reads keep serving whatever is already indexed. Deliberately separate from `SEARCH_PROVIDER` — turning indexing off must not also change which engine reads go to.

## 8. Provider abstraction

`SearchIndexProvider` (`application/ports/search-index-provider.ts`) is the single seam: `indexDocument`/`indexDocuments`/`deleteDocument`/`deleteByFilter`/`search`/`countDocuments`/`ping`. Not one member accepts an engine-shaped filter DSL string, a facet, or a `sort: ["rating:desc"]` array — filters are a plain, closed `SearchIndexQuery` object, and each provider translates it into its own dialect internally. Swapping Meilisearch for Typesense (or for Postgres full-text, or Elasticsearch, in the future) is one new file in `infrastructure/search/providers/` plus one env var; no use case, no use-case test, and no domain type changes.

- **`MeilisearchSearchProvider`** / **`TypesenseSearchProvider`** — each takes a narrow, hand-written structural interface (`MeilisearchClientApi`/`TypesenseClientApi`) describing exactly the handful of calls the provider makes, rather than the SDK's own client class. The real SDK client satisfies it structurally; only `search-provider-factory.ts` imports `meilisearch`/`typesense` directly. This keeps every provider's filter-string construction, sort translation, score normalization, and pagination arithmetic unit-testable against a small recording fake — no HTTP, no running engine, no dependency on SDK internals that change between majors.
- **`InMemorySearchProvider`** — not a stub. A complete, working implementation over a process-local `Map`: multi-field weighted text matching (title > subtitle > text), Levenshtein-based typo tolerance calibrated to Meilisearch's own default ladder (0 typos under 5 chars, 1 from 5, 2 from 9), diacritic-insensitive matching (`"Gandía"` found by `"gandia"`), geo distance/radius filtering and `DISTANCE` sorting, every filter (`category`, `city`, `province`, `verifiedOnly`, `minRating`, `minReviewCount`), every sort option with a fully deterministic tie-break chain, and correct pagination. It exists so the entire CQRS pipeline — including this module's own tests — is exercisable end to end with zero external infrastructure, and so "graceful degradation" is itself testable (wrap or replace it with a throwing provider and assert the application keeps serving).
- **Selection** (`search-provider-factory.ts`) — one memoized instance per process, chosen from `SEARCH_PROVIDER` (`"none" | "meilisearch" | "typesense"`, `.catch("none")` so a typo degrades to the safe local option rather than failing startup). `"none"` is the default in every environment without a configured engine (local dev, CI, this repository's entire test suite) and selects `InMemorySearchProvider` — a *functional* default, not a disabled one. A selected engine whose host env var is missing likewise falls back to the in-memory provider with a warning, the same "no outbound call can happen unless deliberately and completely configured" rule `geocoding-provider-factory.ts` already follows — a search index is derived data, and no deployment should ever be blocked by it.

## 9. Observability

`SearchObserver` (`application/ports/search-observer.ts`) is the telemetry seam every indexing/read use case depends on — never `logger`/Sentry directly, mirroring `CacheObserver` (Module 46) and `JobLifecycleObserver` (Module 45) exactly. `createSearchObserver()` (infrastructure) routes: per-document indexed/removed events to `logger.debug` (high-volume, individually uninteresting, invaluable when tracing one entity); batch/rebuild progress to `logger.info`; a degraded *read* to `logger.warn` + Sentry (no request failed, but customers are silently seeing no results — worth surfacing); a failed *write* to `logger.error` + Sentry, deliberately double-reported alongside the job layer's own `onFailed` (different questions: "what is failing to index" vs. "what work is permanently lost").

`/api/health/ready` gains `checks.searchEngine`, reporting: provider reachability and round-trip latency (`SearchIndexProvider.ping()`, contractually never throws), indexed document count, whether the event → job → worker pipeline is wired up in this process (`indexingEnabled`), the `search-index`/`search-index-dead-letter` queue counts, the index name/version, and sync state (`lastSuccessfulSyncAt`, `totalSyncs`, `totalFailures`, last failure) from a per-process `SearchSyncState` — the same per-instance-question, per-process-in-memory trade-off `CacheStatsCollector` and `InMemoryRateLimitRepository` already document, chosen because "is my worker actually draining the queue" is inherently a per-instance question a fleet-wide aggregate would hide.

## 10. Testing strategy

- **Providers** (`tests/unit/core/infrastructure/search/providers/`): `InMemorySearchProvider`'s full behavioral surface — indexing idempotency, deletion (by id and by filter, including the rebuild-sweep `indexedBefore` case), every filter, geo/radius/distance-sort, fuzzy/typo matching at the tolerance boundaries, multi-field weighting, deterministic tie-breaking, and pagination correctness across pages. `MeilisearchSearchProvider`/`TypesenseSearchProvider` against hand-written fakes of their narrow client interfaces — filter/sort string construction, score normalization, upsert semantics, 404-as-no-op deletion, and a `ping()` that never throws.
- **Provider selection**: `search-provider-factory.ts` — env-driven selection, misconfigured-host fallback, memoization.
- **Read model & projection**: `SearchDocumentProjector` (eligibility → document-or-null, `projectMany`'s order/split), `search-document-mapper.ts`'s pure projection functions, `SearchReadModelUseCase` (query mapping, graceful degradation on provider failure).
- **Indexing use cases**: incremental (index vs. remove branch, error propagation), delete (no-op on absent), batch (mixed eligible/ineligible, empty input), rebuild (batching, the stale sweep, idempotent double-run, kind restriction).
- **Event integration**: `EnqueueSearchIndexSubscriber` and `ReindexReviewedProfileSubscriber` (extraction, enqueue-failure swallowing), the five new domain events' own contract tests, and — for the eight modified use cases — that the right event is published after a successful write and that a failing `EventBus` never fails the write.
- **Workers, retry, rebuild, failure recovery** (`tests/integration/search/search-indexing-pipeline.test.ts`): a real Module 45 `Queue` + `Worker`, wired to `InMemorySearchProvider`, end to end — a published domain event lands as a findable document with zero synchronous indexing on the publish path; redelivering the same event id is deduplicated at enqueue time; a failing index attempt is retried with backoff and eventually dead-letters; a redelivered job (different job id, same event id) is caught by execution-time idempotency.
- **Health**: `search-health.ts`'s `collectSearchEngineHealth` (never throws, `"ok"`/`"degraded"`/`"disabled"` logic), and `/api/health/ready`'s `checks.searchEngine` addition.
- **Composition root**: `infrastructure/search/compose.ts` — singleton memoization, the queue/worker's *lazy* construction (built on first actual use, not at module load, so importing this file — including transitively, from every `compose.ts` that now publishes a lifecycle event — never spins up a queue or worker as a side effect of `next build` analysis or of an unrelated test), subscriber-registration idempotence, and `SEARCH_INDEXING_ENABLED=false` behavior.

No existing test was modified to weaken an assertion. The Prisma repositories `compose.ts` constructs are mocked out in `compose.test.ts` (the same way `tests/integration/observability/health-routes.test.ts` already mocks the Prisma client for its own readiness-route tests) — nothing in this module's test suite requires a running database or a platform-matching Prisma query-engine binary.

## 11. Future scalability

- **Autocomplete** — the port already separates `text` matching from filtering; a dedicated `suggest()`-style method (or a shorter-field, prefix-optimized index) is an additive port member, not a redesign.
- **Multi-index** — `buildSearchIndexName()` already versions and namespaces the index; splitting `PROFESSIONAL`/`COMPANY`/`SERVICE_REQUEST` into separate physical indexes (for independent scaling or per-kind settings) is a provider-internal change behind the same port.
- **Geo at scale** — `SearchIndexQuery.near` and `SearchIndexHit.distanceKm` are already engine-native concepts on Meilisearch/Typesense; nothing in the application layer assumes an application-side Haversine calculation the way Module 19's Postgres pipeline does.
- **Migrating a live page from Module 19 to the CQRS read model** — since `SearchReadModelUseCase` and `SearchDirectoryUseCase` share no code path, cutting a page over is swapping which use case a Server Action calls, with `degraded` giving that page a built-in fallback story from day one.

## 12. What did not change

Module 19's `SearchDirectoryUseCase`, the discovery repositories, and the domain ranking engine — untouched. Modules 44–46's own files were touched only additively and narrowly: `createManagedQueue`/`getBackgroundJobRuntime`/`createJobStore`/`createJobIdempotencyStore` are *used*, never modified, from `infrastructure/jobs/compose.ts`; `src/app/api/health/ready/route.ts` gained one new `checks.searchEngine` key, following the exact pattern `checks.cachingLayer`/`checks.queue` already established. Every pre-existing test's assertions are unchanged. The eight existing use cases that now publish a lifecycle event (`CreateProfessionalUseCase`, `UpdateProfessionalUseCase`, `DeactivateProfessionalUseCase`, `UpdateProfessionalServicesUseCase`, `CreateCompanyUseCase`, `UpdateCompanyUseCase`, `UpdateCompanyServicesUseCase`, `UpdateServiceRequestUseCase`) had no change to their validation, return types, or business logic — the only diff is a trailing, defaulted `EventBus` constructor parameter and one `publishDomainEvent(...)` call after the write already succeeded.
