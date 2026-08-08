# Module 50 — Analytics Dashboard (CQRS Read Model)

## 1. Goal

Give platform operators a fast, single-request admin dashboard — growth,
marketplace activity, revenue, disputes, support load, search and realtime
health — without ever making the dashboard itself a second source of
truth for those numbers, and without repeating Module 23's own aggregate
Postgres queries on every dashboard view. The write model (Prisma/Postgres,
queried through Module 23's own reporting repositories) remains
authoritative; the dashboard is a derived, disposable, eventually-consistent
projection of it, maintained by background workers reacting to domain
events and a periodic schedule — exactly the shape Module 47 established
for search, applied to a KPI dashboard instead of a search index.

## 2. Architecture

### 2.1 Layering

```
domain/entities/
  analytics-dashboard.ts        (AnalyticsDashboard, AnalyticsDashboardSnapshot — the read model)

domain/repositories/
  analytics-extras-repository.ts (DisputeAnalyticsRepository, SupportTicketAnalyticsRepository —
                                   the two KPI areas Module 23 didn't already cover)

application/ports/
  analytics-read-model-store.ts  (AnalyticsReadModelStore — where the materialized snapshot lives)
  analytics-refresh-queue.ts     (AnalyticsRefreshQueue — "request a recompute", no queue/Prisma knowledge)
  analytics-observer.ts          (AnalyticsObserver + nullAnalyticsObserver)

application/services/analytics/
  analytics-dashboard-assembler.ts (reads every source, builds one AnalyticsDashboard)

application/use-cases/analytics-dashboard/
  get-dashboard-analytics.use-case.ts      (the CQRS query side)
  refresh-analytics-read-model.use-case.ts (the coalesced, event/scheduled write side)
  rebuild-analytics-read-model.use-case.ts (the explicit, never-coalesced operator rebuild)
  enqueue-analytics-refresh.subscriber.ts  (generic event -> enqueue bridge)

application/dto/
  analytics-dashboard.dto.ts     (getDashboardAnalyticsQuerySchema, AnalyticsDashboardResponseDTO)

infrastructure/database/prisma/repositories/
  prisma-dispute-analytics-repository.ts
  prisma-support-ticket-analytics-repository.ts

infrastructure/analytics/
  cache-analytics-read-model-store.ts (AnalyticsReadModelStore over Module 46's CacheNamespace)
  analytics-refresh-jobs.ts       (job vocabulary, coalesced job id derivation)
  analytics-refresh-queue-adapter.ts (AnalyticsRefreshQueue over a Module 45 Queue)
  analytics-refresh-job-processor.ts (Worker's JobProcessor — routes a job to refresh/rebuild)
  analytics-observability.ts      (AnalyticsObserver over logger + Sentry)
  analytics-health.ts             (AnalyticsHealthReport shape + collectAnalyticsHealth)
  compose.ts                      (composition root: read side, write side, subscriptions, schedule, health)

app/api/analytics/dashboard/route.ts (thin controller: GET reads, POST rebuilds — admin-only)
```

Application code — the four analytics-dashboard use cases, the assembler,
the subscriber — depends only on `AnalyticsReadModelStore`/
`AnalyticsRefreshQueue`/`AnalyticsObserver` plus other modules' own
application-layer use cases (Module 23's `GetPlatformAnalyticsSummaryUseCase`/
`GetPlatformFunnelUseCase`, Module 47's `SearchIndexProvider`). It never
imports Prisma, `CacheProvider`, or a Module 45 `Queue`/`Worker` directly —
only `infrastructure/analytics/` and the two new Prisma repositories are
allowed to know any of that exists.

### 2.2 Relationship to Module 23's analytics repositories

This module is additive, not a replacement. Module 23's
`GetPlatformAnalyticsSummaryUseCase`, `GetPlatformFunnelUseCase`, and the
professional/customer summary use cases remain the platform's live,
ranged, strongly-consistent analytics queries — perfectly adequate for an
admin who picks a specific date range and wants an exact-as-of-now answer.
`AnalyticsDashboardAssembler` calls those *same* use cases (unmodified) to
build the cached snapshot this module serves — it is a caching/refresh
layer in front of Module 23, not a second implementation of the same
arithmetic. No figure in `AnalyticsDashboard` is computed independently of
Module 23 (or, for revenue, of Module 22 via Module 23) except the two new
KPI areas that had no existing aggregate query at all: disputes and
support tickets (§2.3).

### 2.3 What is new in this module vs. reused from Module 23

| KPI area | Source |
|---|---|
| Growth (users/professionals/companies) | Module 23 `PlatformAnalyticsRepository` (reused, unmodified) |
| Marketplace (quotes, service requests, funnel) | Module 23 (reused, unmodified) |
| Bookings/Jobs | Module 23 (reused, unmodified) |
| Reviews | Module 23 (reused, unmodified) |
| Revenue | Module 22, via Module 23's own re-export (reused, unmodified) |
| **Disputes** | **New** — `PrismaDisputeAnalyticsRepository` (this module) |
| **Support tickets** | **New** — `PrismaSupportTicketAnalyticsRepository` (this module) |
| Search | Module 47's own `SearchIndexProvider.ping()` (reused, unmodified) |
| Realtime | Module 48's own `getRealtimeHealth()` (reused, unmodified) |

The two new repositories follow `analytics-repository.ts`'s own documented
precedent exactly: narrow, read-only, purpose-built reporting interfaces,
never a mutating method, kept separate from `DisputeRepository`/
`SupportTicketRepository` (both scoped to their own module's transactional
CRUD).

## 3. CQRS design

**Write side** — Module 23's own use cases are completely unchanged; they
still read Postgres via Prisma exactly as before. This module's own write
side is `RefreshAnalyticsReadModelUseCase`/`RebuildAnalyticsReadModelUseCase`,
which call `AnalyticsDashboardAssembler.assemble()` (itself calling Module
23's use cases plus the two new repositories) and write the result into
`AnalyticsReadModelStore`.

**Read side** — `GetDashboardAnalyticsUseCase.execute()` asks the store
first; it never touches Postgres on a cache hit. It **is** wired into a
route (`/api/analytics/dashboard`, admin-only) in this module, unlike
Module 47's `SearchReadModelUseCase` (which was built but not yet routed) —
a KPI dashboard has an obvious, low-risk integration point (a thin,
admin-only Route Handler) that a customer-facing search page did not.

**Consistency** — eventually consistent, exactly like Module 47. A
dashboard read reflects whichever recompute last completed, which can lag
the write model by however long the event → queue → worker pipeline (or
the scheduled interval) takes to drain. Nothing in this module makes any
write path wait for a dashboard recompute.

## 4. Why the read model is one artifact, not many

Module 47's search index has many independent documents, each
independently indexable — "index professional X" and "index company Y"
are genuinely different, parallel operations. A KPI dashboard has no such
structure: every field in `AnalyticsDashboard` already comes from a
grouped/aggregate query over an entire table (`groupBy`, `COUNT`, `AVG`),
so there is no per-entity slice to refresh incrementally. Recomputing "just
the reviews section" and recomputing the whole dashboard cost almost
exactly the same amount of work (Module 23's own summary use case already
runs every one of its aggregate queries with `Promise.all`), and there is
no cheaper partial update available.

This single fact shapes several design choices documented below:

- **`RefreshAnalyticsReadModelUseCase` and `RebuildAnalyticsReadModelUseCase`
  run the identical query.** They exist as two classes for operational
  parity with Module 47 (distinct job types, distinct log events, distinct
  API affordances — an automatic coalesced path vs. an explicit
  never-coalesced one), not because the computation differs. See each
  class's own doc comment.
- **Every event-triggered refresh request coalesces onto one job id**
  (`analytics-refresh-jobs.ts`'s `REFRESH_JOB_ID`), unlike Module 47's
  per-entity indexing jobs. A burst of ten domain events in the same
  second — a bulk review import, several disputes resolved together —
  enqueues (and eventually runs) exactly one recompute, which reads the
  *current* state of every table and therefore reflects all ten changes
  regardless of how many jobs were coalesced away.
- **The cached dashboard is always the unranged (all-time) window.**
  Module 23's own use cases still accept a caller-supplied date range for
  a live, uncached, ranged query; a per-range cache would multiply the
  number of artifacts to keep fresh (one cache entry per distinct
  `{from, to}` pair requested) for a KPI-overview use case that, in
  practice, asks "how are we doing right now," not "how were we doing in
  this specific historical window." A future ranged view remains directly
  available by calling Module 23's own use cases, unchanged.

## 5. Event flow — event-driven where an event exists, scheduled elsewhere

**This is the module's central, deliberate design decision, stated
explicitly per the brief that scoped this work.** The task that
originated this module listed several "example" domain events —
`BookingCreated`, `BookingCompleted`, `QuoteAccepted`, `NotificationSent`,
`SmsSent`, `SearchIndexed`, `RealtimeConnected`, `CacheHit`, `CacheMiss` —
**none of which exist** in `src/core/domain/events/` at the time this
module was built, and this module does not invent them. The platform has
no `Booking` entity at all (the closest analogs are `Job`/`Appointment`),
and several of the listed KPI areas (notification delivery, SMS delivery,
search indexing progress, realtime connection lifecycle, cache hit/miss)
have never been modeled as domain events anywhere in this codebase — they
are operational/infrastructure signals, not business facts a use case
publishes.

The rule this module follows: **subscribe to a domain event only where one
already exists and already changes a number this dashboard reports; for
every other KPI area, rely entirely on the scheduled periodic refresh.**
Both paths write through the exact same `RefreshAnalyticsReadModelUseCase`
— there is no second, degraded computation path for the scheduled-only
areas, only a difference in *when* a recompute is triggered.

```
Use case writes to Postgres (unchanged — any of Modules 06–41)
        │
        ▼
publishDomainEvent(eventBus, SomeEvent)         (unchanged — Module 34's shared eventBus)
        │
        ▼
EnqueueAnalyticsRefreshSubscriber.handle(event)  — extracts nothing from the
        │                                          event but its id; every
        │                                          trigger enqueues the same
        │                                          "recompute the dashboard"
        │                                          request (§4)
        ▼
AnalyticsRefreshQueue.enqueue(request)           (application-layer port)
        │
        ▼
AnalyticsRefreshQueueAdapter                     (infrastructure — adapts onto a Module 45 Queue)
        │
        ▼
Module 45 Queue  →  Module 45 Worker             (analytics-refresh-job-processor.ts routes the job)
        │
        ▼
RefreshAnalyticsReadModelUseCase / RebuildAnalyticsReadModelUseCase
        │
        ▼
AnalyticsDashboardAssembler.assemble()  →  AnalyticsReadModelStore.set()  →  PublishToChannelUseCase (Module 48, "admin" channel)
```

The **scheduled** path is identical from `AnalyticsRefreshQueue.enqueue()`
onward — `JobScheduler` (Module 45) enqueues a `{ operation: "refresh",
reason: "scheduled" }` job on a fixed interval
(`ANALYTICS_SCHEDULED_REFRESH_INTERVAL_MS`, default 15 minutes), which
runs through the identical worker/use case/store/realtime path.

### 5.1 Event-driven vs. scheduled — the full accounting

| KPI area | Trigger | Why |
|---|---|---|
| Growth (users/professionals/companies) | Event (`professional.created`/`.updated`, `professional-verification.status-changed`, `company.created`/`.updated`/`.status-changed`, `company-verification.status-changed`, `company-invitation.status-changed`, `company-membership.changed`) + scheduled backstop | Every one of these already exists and already changes a growth figure |
| Reviews | Event (`review.created`/`.updated`/`.deleted`) + scheduled backstop | Existing events |
| Disputes | Event (`dispute.created`, `dispute.status-changed`) + scheduled backstop | Existing events |
| Support tickets | Event (`support-ticket.status-changed`) + scheduled backstop | Existing event |
| Revenue | Event (`payment.captured`) + scheduled backstop | Existing event |
| Service-request volume/funnel | Event (`service_request.updated`) + scheduled backstop | Existing event |
| **Quotes** | **Scheduled only** | No `QuoteCreated`/`QuoteAccepted` domain event exists |
| **Bookings/Jobs** | **Scheduled only** | No `Booking`/`Job` lifecycle event exists (no `Booking` entity at all) |
| **Search** | **Scheduled only** (read live via `SearchIndexProvider.ping()` on every recompute) | No `SearchIndexed` event exists; Module 47 already avoids inventing one (§4.2 of that module's own doc) |
| **Realtime** | **Scheduled only** (read live via `getRealtimeHealth()` on every recompute) | No `RealtimeConnected`/`CacheHit`/`CacheMiss` events exist — these are transport/infrastructure signals, not business facts |

Every scheduled-only area is still refreshed at least every
`ANALYTICS_SCHEDULED_REFRESH_INTERVAL_MS` (default 15 minutes) — the same
staleness bound the whole dashboard already accepts as its eventual-
consistency contract (§3) — and every read that misses the cache
recomputes live regardless of trigger (§6). No KPI on this dashboard is
ever *permanently* stale; only its refresh cadence differs.

### 5.2 Why refreshing never happens in a request handler

Identical reasoning to Module 47 §4.2: the platform's default
`SynchronousEventBus` dispatches every subscriber inline, inside the
publisher's own call stack. `EnqueueAnalyticsRefreshSubscriber` holds only
an `AnalyticsRefreshQueue`, never an `AnalyticsDashboardAssembler` — it is
structurally incapable of running the several-aggregate-query recompute
inside, say, the request that just created a review.

## 6. Read model lifecycle & graceful degradation

`GetDashboardAnalyticsUseCase.execute()`:

1. Cache hit (and no `forceRefresh`) → return the stored snapshot
   (`source: "cache"`... actually the store preserves whatever `source`
   the writer recorded — `"event"`/`"scheduled"`/`"manual-rebuild"` —
   `GetDashboardAnalyticsUseCase` itself never overwrites it).
2. Cache miss or `forceRefresh` → recompute live via the assembler, store
   it (`source: "live"`), return it. This is what keeps the dashboard
   correct even before the very first scheduled/event-triggered refresh
   has run, at the cost of that one caller paying for the live query.
3. Both the store *and* the live recompute fail → return
   `{ data: null, source: "degraded", degraded: true }` rather than
   throwing. Mirrors `SearchReadModelUseCase`'s `{ items: [], degraded:
   true }` contract exactly: every number on this dashboard is derived,
   recoverable data, never the source of truth for a customer-facing
   action, so an admin sees "analytics temporarily unavailable" instead of
   a 500.

`RebuildAnalyticsReadModelUseCase` (§4) is safe by construction, trivially
compared to Module 47's rebuild: because the read model is a single key,
`store.set()` replaces it atomically from a reader's point of view, and
the computation runs to completion *before* anything is written — there is
no window where a reader sees a partially-rebuilt dashboard.

## 7. Failure recovery

Retry, exponential backoff, dead-lettering, and execution-time idempotency
are entirely Module 45's, configured (not reimplemented) exactly as Module
47 configures them:

- **Enqueue-time coalescing** — every `operation: "refresh"` job shares
  one deterministic id (`REFRESH_JOB_ID`), so `Queue.add`'s own `SET NX`
  semantics collapse a burst of triggering events into one pending
  recompute. `operation: "rebuild"` jobs key on their reason instead,
  deliberately never sharing that id — an operator-triggered rebuild must
  never be silently coalesced away by a pending automatic refresh.
- **Execution-time idempotency** — opted **out** (`null` key) for every
  job in this queue, the mirror image of Module 47's rebuild-only opt-out.
  Every job here is already idempotent by construction (recompute the
  current state and overwrite), so a redelivered job is safe to simply run
  again rather than needing to be skipped.
- **Retry with backoff** — exponential from 1s with 20% jitter, the same
  policy every other queue in this codebase uses.
- **Dead-lettering** — `analytics-refresh-dead-letter`, parking a job's
  full payload once attempts are exhausted.
- **Errors are thrown, never swallowed** inside
  `RefreshAnalyticsReadModelUseCase`/`analytics-refresh-job-processor.ts` —
  catching here would silently convert a failed recompute into a
  "successful" job and leave the dashboard stale with no trace.

## 8. Cache

`CacheAnalyticsReadModelStore` (`infrastructure/analytics/
cache-analytics-read-model-store.ts`) is the one production
`AnalyticsReadModelStore`, backed by Module 46's `CacheNamespace`
(`getCacheNamespace("analytics-dashboard")`) — reusing `CacheManager`'s
existing Redis-or-in-memory fallback, versioning, and hit/miss statistics
wholesale. `ANALYTICS_CACHE_TTL_MS` (default 5 minutes) bounds how long a
snapshot may be served before a read forces a live recompute even absent
any refresh trigger — a second, cache-level staleness bound independent
of, and tighter than, the 15-minute scheduled-refresh interval.

## 9. Realtime

`RefreshAnalyticsReadModelUseCase` publishes `analytics.dashboard-updated`
onto Module 48's existing `"admin"` channel (a platform-staff-only,
singleton channel `RealtimeChannel` already supports — no new channel type
was added) via the existing `PublishToChannelUseCase`, best-effort: a
failed publish never fails a refresh that already succeeded and is already
durably cached.

## 10. Observability

`AnalyticsObserver` (`application/ports/analytics-observer.ts`) is the
telemetry seam every analytics use case depends on — never `logger`/Sentry
directly, mirroring `SearchObserver`/`CacheObserver`/`JobLifecycleObserver`
exactly. `createAnalyticsObserver()` routes: cache hit/miss to
`logger.debug`; a completed refresh to `logger.info`; a failed refresh to
`logger.error` + Sentry (deliberately double-reported alongside the job
layer's own `onFailed`, the same "what is failing" vs. "what work is
permanently lost" split Module 47 documents); a degraded read to
`logger.warn` + Sentry.

`/api/health/ready` gains `checks.analytics`: whether the refresh pipeline
is enabled, whether a snapshot currently exists, its timestamp/source, and
the `analytics-refresh`/`analytics-refresh-dead-letter` queue counts —
reported for operational visibility only, never allowed to change the
route's overall status or HTTP code, following the exact `checks.searchEngine`/
`checks.smsProvider` precedent (§ each of those modules' own doc).

## 11. Presentation

`GET /api/analytics/dashboard` (optional `?forceRefresh=true`) and
`POST /api/analytics/dashboard` (triggers an explicit rebuild) — both
admin-only (`requireRole(ROLES.ADMIN, ROLES.SUPER_ADMIN)`), thin
controllers with zero business logic, matching the house style
`/api/realtime/channels/route.ts` and `/api/health/ready/route.ts`
establish. **No dashboard UI was built.** `src/app/(dashboard)/analytics/`
and `src/app/(dashboard)/admin/analytics/` already exist (Module 23's
customer- and admin-facing Server Actions) but have no chart/table UI to
extend, and `src/presentation/components/dashboard/kpi-card.tsx` is the
only pre-existing building block generic enough to reuse — not enough of
an established pattern to build a full dashboard view cheaply and safely
within this module's scope. Per this module's own brief, the read model +
API + tests + docs were prioritized; a dashboard page consuming
`GET /api/analytics/dashboard` is a natural, low-risk follow-up.

## 12. Testing strategy

- **Domain**: `analytics-dashboard.ts`'s `buildEmptyDashboardSnapshot`.
- **Assembler**: every source called, concurrently, and mapped correctly
  into `AnalyticsDashboard` (`tests/unit/core/application/services/analytics/`).
- **Use cases**: `GetDashboardAnalyticsUseCase` (cache hit, miss,
  `forceRefresh`, double-failure degradation, a failed cache write never
  failing the read), `RefreshAnalyticsReadModelUseCase` (recompute +
  store + realtime publish, trigger→source mapping, a failed realtime
  publish swallowed, a failed recompute thrown/never swallowed),
  `RebuildAnalyticsReadModelUseCase` (delegates with the right
  reason/trigger, timing, error propagation).
- **Subscriber**: `EnqueueAnalyticsRefreshSubscriber` — enqueue-only
  (asserted by construction: it is given no assembler/repository to call),
  a failed enqueue swallowed and reported.
- **Infrastructure**: `CacheAnalyticsReadModelStore` (get/set/invalidate,
  `Date` round-tripping), `analytics-refresh-jobs.ts` (every `refresh` job
  shares one id regardless of reason/event; `rebuild` jobs are keyed
  separately; idempotency always opts out), the job processor (routes
  `refresh`/`rebuild`, propagates errors), `analytics-health.ts` (never
  throws, `"ok"`/`"degraded"`/`"disabled"` logic), the two new Prisma
  repositories (groupBy → typed statistics, all-zero on no rows), and
  `compose.ts` (singleton memoization, lazy queue/worker construction,
  `ANALYTICS_REFRESH_ENABLED=false` behavior).
- **Health route**: two additive assertions in
  `tests/integration/observability/health-routes.test.ts` — `checks.analytics`
  present and "ok"/"disabled" without affecting the route's status/code.
- **Env**: `ANALYTICS_REFRESH_ENABLED`/`ANALYTICS_CACHE_TTL_MS`/
  `ANALYTICS_SCHEDULED_REFRESH_INTERVAL_MS` defaults, coercion, and
  `.catch()` fallback behavior; `env-fixture.ts`'s key-reset list extended.

No existing test was modified to weaken an assertion.

## 13. Performance & scalability

Every query behind this module is a bounded aggregate (`COUNT`, `AVG`,
`groupBy`) whose result size is O(distinct statuses/categories), never
O(rows) — the same accounting Module 23's own doc gives for each of its
queries, unchanged here. The cache means a dashboard view is O(1) — one
cache read — for the overwhelming majority of requests; only a cold cache
or an explicit `forceRefresh`/rebuild pays for the full aggregate-query
set, and that cost is identical to (not worse than) calling Module 23's
own summary use case directly.

## 14. What did not change

Module 23's analytics repositories, use cases, DTOs, and Server Actions —
untouched. Module 22's revenue reporting — untouched. Modules 44–49's own
files were touched only additively: `createManagedQueue`/
`getBackgroundJobRuntime`/`createJobStore`/`createJobIdempotencyStore`
(Module 45), `getCacheNamespace` (Module 46), `getSearchProvider` (Module
47), `realtimeHub`/`getRealtimeHealth`/`PublishToChannelUseCase` (Module
48) are all *used*, never modified; `src/app/api/health/ready/route.ts`
gained one new `checks.analytics` key; `instrumentation.ts` gained one new
compose-file import plus one explicit `registerScheduledAnalyticsRefresh()`
call, in the same deterministic-at-boot list every other subscribing
module already appears in.
