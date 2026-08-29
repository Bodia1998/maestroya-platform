# Module 81 — Reconciliation Admin Dashboard & Operations

**Implementation Report**

Branch: `feature/module-81-reconciliation-admin-dashboard`
Status date: 2026-08-29

---

## 1. Scope

Module 81 builds the admin-facing Operations UI on top of Module 80's financial reconciliation
subsystem: an overview dashboard, a paginated/filterable reconciliation-runs list and detail
view, a paginated/filterable discrepancies investigation table and detail view with a
resolution workflow, a manual "run reconciliation now" control, a read-only per-job financial
snapshot drill-down, and an admin navigation entry — all built exclusively on Module 80's
existing domain/application/infrastructure contracts and Server Actions.

Module 80 had already implemented the domain/application/infrastructure/observability/events
layer and one presentation file, `src/app/(dashboard)/admin/reconciliation/actions.ts`, with six
Server Actions (`startReconciliationRunAction`, `getReconciliationRunAction`,
`listDiscrepanciesForRunAction`, `listUnresolvedHighSeverityDiscrepanciesAction`,
`resolveDiscrepancyAction`, `getFinancialEntitySnapshotAction`) — but **no page existed under
that route at all** (`src/app/(dashboard)/admin/reconciliation/` contained only `actions.ts`).

Auditing what those six actions could support against the module spec's required dashboard
(latest/last-successful/last-failed run, total runs, resolved/unresolved/severity/type
breakdowns) surfaced a real gap: Module 80 had no aggregate query, no general filterable
discrepancy list, no runs-list use case/action, and no single-discrepancy lookup by id (only
list-shaped reads existed). Per the task's own instructions ("if Module 80 does not expose a
required metric, do not fabricate it — determine whether a minimal application-layer
query/use case is required"), this module made seven narrowly-scoped additions — described in
full in §3 — rather than inventing numbers or bypassing the use-case boundary from a page.

No Module 80 business rule, check module, lifecycle, fingerprinting, or severity logic was
touched or reimplemented. No Prisma schema/migration was created or modified — every addition
is a new repository *method* against the existing `ReconciliationRun`/`ReconciliationDiscrepancy`
tables Module 80's migration already created.

---

## 2. Architecture

```
Admin UI (Server Components + a handful of "use client" dialogs)
  -> Server Actions (src/app/(dashboard)/admin/reconciliation/actions.ts)
       -> requireRole(ADMIN, SUPER_ADMIN)   [every single export, no exception]
       -> zod schema validation (reconciliation.dto.ts)
       -> Application use case (src/core/application/use-cases/reconciliation/*)
            -> Domain repository ports (ReconciliationRunRepository /
               ReconciliationDiscrepancyRepository) and read-only domain services
                 -> Infrastructure: Prisma repositories, Stripe/Null provider adapter
```

Every page is a Server Component that calls a Server Action and renders the returned DTO. The
only "use client" components are `TriggerRunDialog` and `ResolveDiscrepancyDialog` (both thin
wrappers around `ConfirmDialog` + a Server Action call) and the small `SeverityBadge`/
`ResolutionStatusBadge`/`RunStatusBadge` presentational components. No component in this module
imports Prisma, imports the Stripe SDK, or computes a financial figure — every number rendered
is a field already present on `ReconciliationRunRecord`/`ReconciliationDiscrepancyRecord`/
`JobFinancialContext`, or a pre-aggregated count returned by a use case.

---

## 3. Module 80 additions (the "minimal application-layer query" the audit found necessary)

All seven are read-only additions; none write to any table, none introduce a new Prisma model,
and every one composes existing repository primitives (`prisma.<model>.count` /
`.groupBy` / `.findMany` with a `where`) rather than a raw query.

1. **`ReconciliationRunRepository.count(status?)`** (domain port + `PrismaReconciliationRunRepository`
   impl) — bounded `COUNT(*)`, optionally filtered by status.
2. **`ReconciliationDiscrepancyRepository.list(options)`** — the general filterable/paginated
   query the Discrepancies table needs (resolution status + severity + category + entity type +
   detected-at date range, all optional, all server-side) — `listForRun`/`listUnresolved` each
   cover one fixed shape and neither supports this combination.
3. **`ReconciliationDiscrepancyRepository.countByResolutionStatus()`** — two bounded `COUNT(*)`
   queries (open vs. resolved totals for the overview).
4. **`ReconciliationDiscrepancyRepository.getOpenSeverityCounts()`** — `groupBy severity` over
   `OPEN` rows (the overview's critical/high/medium/low tiles).
5. **`ReconciliationDiscrepancyRepository.getOpenCategoryCounts()`** — `groupBy category` over
   `OPEN` rows, sorted by count in application code (the overview's "by type" section).
6. **`ReconciliationDiscrepancyRepository.getSeverityCountsForRun(runId)`** — `groupBy severity`
   scoped to one run's `detectedByRunId` regardless of resolution status (the run detail page's
   severity breakdown — this is *not* the same as #4, which is open-only and run-agnostic).
7. **A single-discrepancy read path**: `ReconciliationDiscrepancyRepository.findById` already
   existed (used internally by `resolve`/`createOrTouch`) but no use case or Server Action
   exposed it — every existing discrepancy read returned a list. Added `GetDiscrepancyByIdUseCase`
   / `getReconciliationDiscrepancyAction` to expose it for the detail page, rather than the page
   approximating an id lookup out of a filtered list or reaching into the repository directly.

New application-layer use cases wired through the existing `compose.ts` composition root (no
new dependency, no new binding — every factory reuses the same `runs`/`discrepancies`/`dataSource`
instances Module 80 already constructed):

- `ListReconciliationRunsUseCase`
- `ListDiscrepanciesUseCase`
- `GetReconciliationOverviewUseCase` (orchestrates #1 + three `runs.list({limit:1,...})` calls +
  #3 + #4 + #5 into one DTO, run concurrently via `Promise.all` — one round trip for the whole
  overview page)
- `GetReconciliationRunSeverityBreakdownUseCase` (#6)
- `GetDiscrepancyByIdUseCase` (#7)

New Server Actions on the existing `actions.ts` (all gated by the same
`requireRole(ROLES.ADMIN, ROLES.SUPER_ADMIN)` every pre-existing action already used):
`listReconciliationRunsAction`, `listDiscrepanciesAction`, `getReconciliationOverviewAction`,
`getReconciliationRunSeverityBreakdownAction`, `getReconciliationDiscrepancyAction`,
`getReconciliationProviderBindingAction`. `revalidatePath` was added to
`startReconciliationRunAction` (`/admin/reconciliation`, `/admin/reconciliation/runs`) and
`resolveDiscrepancyAction` (`/admin/reconciliation`, `/admin/reconciliation/discrepancies`,
`/admin/reconciliation/discrepancies/[id]`) — Module 80's original versions of both actions had
none, unlike every comparable admin mutation elsewhere in the app (e.g. `admin/disputes/actions.ts`).

`RECONCILIATION_PROVIDER_BINDING_LABEL` (exported from `compose.ts`) is a static read of which
`ProviderFinancialReconciliationPort` implementation is currently bound (`Null` vs. `Stripe`) —
not a use case, since there is no domain/application logic in reading which infrastructure class
a composition root instantiated. This answers the module spec's "provider status where already
supported by Module 80" requirement without inventing a live per-provider health check Module 80
never built.

---

## 4. UI

Route: `/admin/reconciliation` (App Router, matching this repo's existing `/admin/<feature>`
convention exactly).

- **`/admin/reconciliation`** — overview: latest/last-successful/last-failed run (linked),
  total run count, unresolved/resolved discrepancy totals, open-discrepancy severity breakdown
  (4 tiles), open-discrepancy-by-type breakdown (top 8), the provider adapter binding, and the
  manual "Run reconciliation now" trigger.
- **`/admin/reconciliation/runs`** — paginated (`DEFAULT_PAGE_SIZE`, same convention as every
  other admin list), status-filterable table: run id, scope, status badge, started-at, duration
  (derived from `durationMs`), records inspected, discrepancy count.
- **`/admin/reconciliation/runs/[id]`** — run id/scope/status/started/completed/duration,
  failure message when `FAILED`, severity breakdown for that run, and its own discrepancies
  (up to 100, linked to each detail page). 404s via Next's `notFound()` for a missing or
  malformed run id.
- **`/admin/reconciliation/discrepancies`** — paginated, filterable by resolution status,
  severity, entity type, category ("type"), and a detected-at date range — every filter applied
  server-side via `ListDiscrepanciesUseCase`, encoded in the URL's search params for deep
  linking/shareability/refresh-persistence.
- **`/admin/reconciliation/discrepancies/[id]`** — identity (entity type, fingerprint),
  financial information (internal/provider amount, difference, currency — formatted with the
  project's existing `formatMoney` from `quote-items-table.tsx`), every reference (job/payment/
  invoice/payout/refund/credit-note/entity id, each a plain id or a link), timeline (detected/
  updated/detecting run/last-seen run), and resolution (resolver, timestamp, reason) or, if still
  `OPEN`, the resolution control. 404s for a missing/malformed id.
- **`/admin/reconciliation/jobs/[jobId]`** — the read-only `JobFinancialContext` drill-down a
  discrepancy's "Job" reference links to: payments, commission, invoices, payout, refunds,
  credit notes. Only a provider *reference* (Stripe object id) is ever shown, never a secret.

New shared components, scoped to this feature (`_components/badges.tsx` — a Next.js "private"
folder, excluded from routing): `SeverityBadge`, `ResolutionStatusBadge`, `RunStatusBadge`.
These are deliberately **not** added to the app-wide `StatusBadge` vocabulary — that map already
assigns `OPEN` to `"success"` (green) for a Service Request open for quotes, which would be
actively misleading applied to an *unresolved financial discrepancy* (the opposite meaning —
needs attention). Guarded by its own regression test (see §6).

`TriggerRunDialog` (manual reconciliation trigger) and `ResolveDiscrepancyDialog` (resolution
workflow) are both built on the existing `ConfirmDialog` primitive — its own `isSubmitting` state
is what prevents a duplicate submission from a second click, and both surface the Server Action's
own error message (never a client-invented one) on failure. Both call `toast.success`/
`toast.error` (the existing dependency-free toast store) and `router.refresh()` on completion so
the underlying Server Component re-fetches.

---

## 5. Security

- **Server-side authorization on every read and write**: every Server Action this module added
  or touched calls `requireRole(ROLES.ADMIN, ROLES.SUPER_ADMIN)` before touching any use case —
  the same pattern, and the same two roles, as every pre-existing action in this file. There is
  no route in this module that skips this check; the admin layout's own role redirect
  (`src/app/(dashboard)/admin/layout.tsx`) is defense-in-depth, not the only gate.
- **IDOR**: every id-keyed route (`runs/[id]`, `discrepancies/[id]`, `jobs/[jobId]`) is validated
  by a zod UUID schema before the lookup, and the lookup itself is a `requireRole`-gated Server
  Action — an admin can look up any run/discrepancy/job by id (that is the intended scope: an
  admin's authority here is global, exactly like `admin/disputes`, not scoped to "their own"
  records), but an unauthenticated or non-admin caller is rejected before any id is even parsed.
  A malformed id (not a UUID) is rejected by the schema and rendered as `notFound()`, never
  passed through to a query.
- **No secrets rendered**: the job snapshot page shows only gateway *object references*
  (`stripePaymentIntentId`/`stripeTransferId`/`stripeRefundId` — opaque correlation ids, not
  credentials) exactly as Module 80's own `PaymentRecord`/`PayoutRecord`/`RefundRecord` DTOs
  already exposed them to every other part of the app; no API key, webhook secret, or raw
  authorization header is read or rendered anywhere in this module.
- **No client-supplied identity trusted**: `resolveDiscrepancyAction` derives `resolvedByUserId`
  from `requireRole`'s own return value (Module 80's existing behavior, unchanged), never from
  client input.
- **No direct Prisma/Stripe access from the UI or Server Actions** — verified by inspection of
  every new file in `src/app/(dashboard)/admin/reconciliation/`: no import of `@/infrastructure/database/prisma/client`
  or a Stripe SDK anywhere outside the existing Module 80 infrastructure files.

---

## 6. Performance

- Every list page uses the existing `DEFAULT_PAGE_SIZE` (20) prev/next pager convention
  (`AdminTablePager`, `hasNextPage = results.length === pageSize`) — no page ever fetches an
  unbounded set, and no total-row-count query is run just to paginate (matching every other
  admin list in this codebase).
- Filters (`listDiscrepanciesAction`) are applied as a single `where` clause server-side via
  Prisma — never fetched broad and filtered in the browser.
- The overview page issues exactly 7 small, bounded queries (three `list({limit:1})`, one
  `count`, two `groupBy`, one `countByResolutionStatus` — that's two `COUNT` calls internally) —
  all run concurrently via `Promise.all`, not sequentially.
- The run detail page's discrepancy list is capped at 100 rows (the DTO's `listDiscrepanciesForRunSchema`
  max is 200; 100 was chosen for the detail view specifically) with an explicit "+" indicator if
  a run detected more than that.
- No N+1 pattern was introduced: nothing in this module loops over a result set issuing one
  query per row.

---

## 7. Tests

Added this module (all new, none touch or weaken an existing test):

| File | Tests |
|---|---|
| `tests/unit/core/application/use-cases/reconciliation/list-reconciliation-runs.use-case.test.ts` | 3 |
| `tests/unit/core/application/use-cases/reconciliation/list-discrepancies.use-case.test.ts` | 2 |
| `tests/unit/core/application/use-cases/reconciliation/get-reconciliation-overview.use-case.test.ts` | 2 |
| `tests/unit/core/application/use-cases/reconciliation/get-reconciliation-run-severity-breakdown.use-case.test.ts` | 1 |
| `tests/unit/core/application/use-cases/reconciliation/get-discrepancy-by-id.use-case.test.ts` | 2 |
| `tests/unit/app/admin-reconciliation-actions.test.ts` | 17 |
| `tests/unit/presentation/admin-reconciliation/badges.test.tsx` | 7 |
| **Total new** | **34** |

Coverage against the module spec's own test checklist: authorization (every new/changed action
denies a non-admin caller before reaching its use case — parametrized across all 8 actions),
filtering (multi-filter combination test + a 45-row pagination-boundary test), pagination (no
page ever returns more than its limit, verified against a 250/45-row fake), run details (not
covered by a fresh test here — `GetReconciliationRunUseCase`'s not-found behavior was already
covered by Module 80; this module's addition, the severity breakdown, has its own test),
discrepancy details (`GetDiscrepancyByIdUseCase` found/not-found), resolution (success path
revalidates the right paths; a `ConflictError` from an already-resolved discrepancy surfaces as
`{success:false}`, never a thrown exception, and is never a duplicate submission per
`ConfirmDialog`'s own guard — verified at the Server Action level), manual reconciliation
(authorized-vs-denied + revalidation, verified at the Server Action level; `StartReconciliationRunUseCase`'s
own orchestration was already covered by Module 80's 14-test suite, unchanged here).

Also updated (required, not optional — the port additions in §3 are structural and
`FakeReconciliationRunRepository`/`FakeReconciliationDiscrepancyRepository` must implement the
full interface to type-check): `tests/unit/core/application/use-cases/reconciliation/fakes.ts`
(added `count`, `list`, `countByResolutionStatus`, `getOpenSeverityCounts`,
`getOpenCategoryCounts`, `getSeverityCountsForRun` to the two fakes, each mirroring its real
Prisma counterpart's semantics) and a small new
`tests/unit/core/application/use-cases/reconciliation/module-81-fixtures.ts` (record builders
for `ReconciliationRunRecord`/`ReconciliationDiscrepancyRecord`, since Module 80's own fixtures
file only builds `JobFinancialContext` inputs, not persisted records).

No existing assertion was deleted, weakened, or given `any`/`@ts-ignore`/`@ts-expect-error`.

---

## 8. Verification

All commands run from the repository root on the linked device (`macbook-air-bogdan-local`),
darwin-arm64, inside its Linux sandbox shell.

| Command | Result |
|---|---|
| `npx prisma validate` | **Environment-blocked** — the sandbox shell has no network path to `binaries.prisma.sh` (`403 Forbidden` fetching the schema-engine binary for `linux-arm64-openssl-3.0.x`). No schema change was made in this module, so this was never expected to reveal a schema defect; it simply couldn't execute in this sandbox. |
| `npx prisma generate` | **Environment-blocked**, same cause. Not needed: this module adds no Prisma model/field, only repository *methods* using delegate calls (`count`, `groupBy`, `findMany`) already available on the client generated for this schema (confirmed present and dated from the prior Module 80 session — `node_modules/.prisma/client`, generated 2026-08-28). |
| `npx prisma migrate status` | Not run standalone (same network block would apply); no migration was created or needed — see §1. |
| `npm run typecheck` (`tsc --noEmit`) | **PASS — 0 errors** across the whole repository, including every new/changed file in this module. |
| `npm run lint` (`eslint .`) | **PASS — 0 errors/warnings**, whole repository. |
| `npm run test` (`vitest run`, full `tests/unit/**` + `tests/integration/**`) | **PASS — 556 test files, 4,654 tests, 0 failures.** Run in five sequential chunks (`tests/unit/core/application`, `tests/unit/core/domain`, `tests/unit/core/infrastructure`, `tests/unit/app`+`presentation`+`prisma`+`regression`+`shared`, `tests/integration`) purely because the full suite exceeds this environment's single-command time budget — each chunk's own summary line is quoted below. A small number of *unhandled-rejection* log lines appeared in three chunks (`Errors: 2`, `1`, `6`, `3` respectively) — every one is `PrismaClientInitializationError: ... generated for "darwin-arm64", but the actual deployment required "linux-arm64-openssl-3.0.x"` from a handful of test files that dynamically import the Prisma-backed composition root at module-load time inside this Linux sandbox (whose OS/arch doesn't match the darwin-arm64 client that was generated on the real Mac) — an environment mismatch, not a code defect, and every affected test file still shows in the "passed" count. This exactly mirrors the Prisma binary/network limitation Module 80's own report already documented. |
| — `tests/unit/core/application` | 127 files, 888 tests passed |
| — `tests/unit/core/domain` | 127 files, 1,186 tests passed |
| — `tests/unit/core/infrastructure` | 146 files, 1,083 tests passed |
| — `tests/unit/app` + `presentation` + `prisma` + `regression` + `shared` | 94 files, 627 tests passed |
| — `tests/integration` | 62 files, 870 tests passed |
| `npm run build` (`next build`) | **Environment-blocked, did not complete.** Two full attempts (179s and 180s, this sandbox's per-command ceiling) produced no output past the `Next.js 15.1.0` banner. Root-caused: `.env`'s `DATABASE_URL` points at a Supabase host (`aws-0-eu-west-1.pooler.supabase.com`) that **does not resolve from this sandbox at all** (`Temporary failure in name resolution`, confirmed directly) — if any route in this large app performs static generation touching Prisma, the build hangs retrying a DB connection this shell cannot reach, rather than failing fast. This is a pre-existing environment constraint unrelated to anything in this module (every reconciliation page this module added is explicitly `export const dynamic = "force-dynamic"`, so none of them are what a static build would touch) — not a code defect. |
| `git diff --check` | **PASS — 0 whitespace errors.** |
| `git status` / `git diff` | Read-only, confirmed: no `git add`, `git commit`, `git push`, or any other write/destructive git command was run at any point. Every change remains unstaged in the working tree. |

---

## 9. Findings

- **Real gap, not a defect**: Module 80's presentation layer was a Server Actions file with no
  page — the module spec's framing ("Module 80 already implemented... Server Actions") was
  accurate for the six actions that existed, but the admin UI itself genuinely did not exist yet
  (confirmed by `find src/app -path "*reconciliation*"` returning only `actions.ts` before this
  session). This is the primary reason this module exists, not evidence of a Module 80 defect.
- **Missing aggregate/list/lookup queries** (§3) — a genuine, minimal gap in Module 80's
  application layer for anything beyond "start a run" / "resolve one discrepancy" / "look at one
  run's own discrepancies" / "list unresolved above a severity floor." Addressed with seven small,
  read-only additions rather than reworking anything.
- **No `revalidatePath` on the two pre-existing mutating actions** — every other admin mutation
  in this codebase (`admin/disputes/actions.ts`, etc.) calls `revalidatePath` after a successful
  write; Module 80's `startReconciliationRunAction`/`resolveDiscrepancyAction` didn't. Fixed as
  part of wiring the UI to them (§3) — a one-line addition per action, not a behavior change to
  either use case.
- **No Prisma/build verification possible in this sandbox** — both are blocked by this specific
  sandbox shell's lack of network reachability to Prisma's binary CDN and to the project's actual
  (Supabase-hosted) database, not by anything in this module's code. `npm run typecheck` already
  gives strong confidence the Prisma-touching code is type-correct against the generated client,
  and every use case this module added has its own passing unit test against a fake repository.

---

## 10. Remaining work

- **`npx prisma validate`/`generate`/`migrate status` and `npm run build` should be re-run in an
  environment with real network access** (this device's own terminal, or CI) before merge — not
  because a defect is suspected, but because this sandbox genuinely cannot execute them (see §8).
  Given 0 typecheck/lint errors and no schema change, this is expected to be a formality, but it
  has not been directly observed in this session.
- **Provider reconciliation is still bound to `NullProviderReconciliationAdapter`** (a Module 80
  decision, unchanged here) — `RECONCILIATION_PROVIDER_BINDING_LABEL` on the overview page will
  read "Null adapter (not connected to a live provider)" until Module 80's own one-line binding
  switch (documented in that module's own report) is made; this module surfaces that state
  honestly rather than hiding it.
- **No e2e/Playwright coverage was added** for the new pages themselves (only Server Action/use
  case/component-level tests, matching this codebase's existing convention — no other admin
  feature in this repo has page-level rendering tests either; see `MODULE_81_IMPLEMENTATION_REPORT.md`
  §7 and the repo-wide absence of any `admin-*-page*.test.tsx` file).

This module is **complete** for everything achievable inside this sandbox, and **complete with
conditions** overall: the two environment-blocked verification commands (`prisma validate`/
`generate`, `next build`) should be re-run where real network/DB access exists before this branch
is merged.
