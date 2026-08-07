# Module 41 — Reviews & Ratings

Repository: `maestroya-platform-auth`

---

## 1. What this module implements

Module 13 (`docs/MODULE_13_REVIEWS.md`) shipped review *creation* only —
one customer review per completed Job, plus public listing and rating
aggregation. It explicitly deferred editing, deletion, professional
responses, notifications-via-events, and richer statistics. Module 41
closes every one of those gaps and turns the feature into the full,
production-ready Reviews & Ratings system the platform needs:

- `UpdateReviewUseCase` — the review's own author may edit `rating`/
  `comment` within a bounded edit window.
- `DeleteReviewUseCase` — the review's own author may soft-delete it.
- `RespondToReviewUseCase` — the reviewed professional may post, and later
  edit, a public reply.
- Domain events (`ReviewCreated`, `ReviewUpdated`, `ReviewDeleted`,
  `ReviewResponseAdded`) published through the existing Module 34
  `EventBus`, replacing `CreateReviewUseCase`'s old direct
  `NotificationCreator` call with the same "publish, don't call directly"
  pattern every other event-driven module in this codebase already uses
  (Module 37).
- Notification and audit-log subscribers reacting to those events —
  reusing the existing notification infrastructure and the existing
  append-only `AuditLog`/`AdminAuditLogRepository` trail, never a parallel
  system.
- Richer, single-query rating statistics: average, count, a full 1–5
  rating distribution, and the most recent review date.
- An exact-rating filter on the public listing.
- A soft-delete lane on `Review` (`deletedAt`) distinct from Module 16's
  own admin-moderation axis (`Review.status`).

Everything Module 13 already built — the completed-Job eligibility rule,
`resolveJobActor`-based authorization, the one-review-per-Job constraint,
the DTOs/Server Action for creation, the `ReviewRepository` shape — is
reused as-is. Nothing in Module 13's own business logic was rewritten;
`CreateReviewUseCase`'s validation/authorization/eligibility logic is
untouched line-for-line, only its side-effect wiring changed (see §7).

## 2. Business rules

### Creation (Module 13, unchanged)

- The related Job must be `COMPLETED`.
- The caller must be the Job's own customer (`resolveJobActor`).
- At most one review per Job (application check + DB unique constraint on
  `Review.jobId`).
- The reviewee is always derived from the Job, never from client input.

### Editing (Module 41, new — `UpdateReviewUseCase`)

- Only the review's own author (`reviewerId`) may edit it. An unrelated
  caller — including the reviewed professional — gets `NotFoundError`,
  the same "no distinguishable forbidden response" convention every
  ownership check in this codebase already follows.
- Only within `REVIEW_EDIT_WINDOW_HOURS` (72 hours, `review-rules.ts`) of
  the review's own `createdAt`. Re-derived from the review record at call
  time — never a client-supplied flag.
- The new rating is re-validated by the same `isValidRating` domain rule
  `CreateReviewUseCase` uses.
- A soft-deleted review can no longer be edited.

### Deletion (Module 41, new — `DeleteReviewUseCase`)

- Only the review's own author may delete it (same ownership check as
  editing).
- Soft delete only — sets `Review.deletedAt`, never removes the row. No
  time-window restriction: an author may retract their review at any
  time, unlike editing its content, which is bounded (see §2's own
  reasoning in `DeleteReviewUseCase`'s doc comment).
- Deleting an already-deleted review is rejected (`NotFoundError`), not
  silently repeated.

### Professional response (Module 41, new — `RespondToReviewUseCase`)

- Only the `User` behind the review's own
  `revieweeProfessionalProfileId` may respond — resolved server-side via
  `ProfessionalRepository.findById`, never trusted from client input.
  There is no `professionalProfileId` parameter on this use case's input
  at all; a professional can never respond to another professional's
  review, and the review's own author cannot respond to their own review
  either (both surface the same `NotFoundError`).
- Calling this a second time for the same review *edits* the response —
  `Review.response`/`respondedAt` are overwritten, not versioned. The
  full edit history is preserved in the append-only audit log instead
  (`RecordReviewResponseAddedAuditLogSubscriber`, which fires — and
  records the response text — on every post and every edit).
- A soft-deleted review can no longer receive a response.

## 3. Rating system

- Overall rating: integer 1–5 (`isValidRating`, unchanged from Module 13),
  enforced at the DTO boundary (Zod) and again inside every use case that
  writes a rating (defense in depth, same convention as every other
  domain rule in this codebase).
- Optional comment, trimmed, capped at 2000 characters
  (`MAX_COMMENT_LENGTH`, unchanged).
- New in Module 41: optional professional response, trimmed
  (`normalizeResponse`), capped at 2000 characters (`MAX_RESPONSE_LENGTH`).
- The rating scale itself (`RATING_SCALE = [1,2,3,4,5]`) is a named
  constant in `review-rules.ts`, not hardcoded at each call site —
  "configurable" in the sense that changing the scale is a one-place
  change (`MIN_RATING`/`MAX_RATING`/`RATING_SCALE`), the same convention
  `DISPUTE_WINDOW_DAYS` uses for Disputes' own tunable constant.

## 4. Professional response — auditability

`Review.response`/`respondedAt` only ever hold the *current* text — same
"overwrite, don't version" contract the review row itself already has.
Full auditability comes from `RecordReviewResponseAddedAuditLogSubscriber`,
which appends a new `AuditLog` entry (via the existing
`AdminAuditLogRepository`) carrying the exact response text on every post
and every edit. This is the same trade-off Module 13 made for the review
itself (no row-versioning; the row is the current state, the log is the
history) — Module 41 doesn't introduce a new pattern, just extends the
existing one to cover the reply.

## 5. Rating statistics — efficiency

`ProfessionalRatingSummary` now also carries `ratingDistribution` (count
per star, 1–5, zero-filled) and `lastReviewAt`. All four numbers —
average, count, distribution, last-review date — come from a **single**
`prisma.review.groupBy({ by: ["rating"], _count, _max: { createdAt } })`
call in `PrismaReviewRepository.getProfessionalRatingSummary`, not one
query per statistic. Grouping by `rating` (at most 5 groups) gives the
distribution directly; the overall count is the sum of the per-group
counts; the overall average is `sum(rating * count) / count` (exact, no
floating-point accumulation from summing individual ratings); the overall
last-review date is the max of each group's own max. A naive
implementation would need an `aggregate` (avg+count) + five per-rating
`count` calls + one more `aggregate` (max date) — seven round trips,
collapsed into one.

A new composite index,
`@@index([revieweeProfessionalProfileId, status, deletedAt])`, covers this
query's (and the public listing's) exact `WHERE` shape.

## 6. Query optimization / pagination

`ListProfessionalReviewsUseCase`/`listByProfessionalId` keep Module 13's
existing `limit`/`offset` pagination shape (this codebase's established
convention — no cursor-pagination helper exists elsewhere to "reuse"; the
brief's reference to a Module 40 pagination convention did not correspond
to any additional API surface in this codebase at the time Module 41 was
built, so the existing, already-deterministic `limit`/`offset` + `orderBy:
[{ createdAt: "desc" }, { id: "desc" }]` tiebreak convention — identical
to `PrismaAdminAuditLogRepository.list`'s own — was extended rather than
replaced). New in Module 41: an optional exact `rating` filter
(`ListProfessionalReviewsOptions.rating`), applied at the query level, not
in the use case, same as every other filter in this codebase's listing
repositories. No N+1 queries were introduced anywhere in this module —
every read remains a single Prisma call with a narrow `select`.

## 7. Event integration

Four new domain events (`src/core/domain/events/`):

| Event | Published by | Reacted to by |
|---|---|---|
| `ReviewCreated` | `CreateReviewUseCase` | `RecordReviewCreatedAuditLogSubscriber`, `NotifyReviewCreatedSubscriber` |
| `ReviewUpdated` | `UpdateReviewUseCase` | `RecordReviewUpdatedAuditLogSubscriber` (no notification — an edit doesn't need to re-notify the professional) |
| `ReviewDeleted` | `DeleteReviewUseCase` | `RecordReviewDeletedAuditLogSubscriber` (no notification — out of scope, see doc comment) |
| `ReviewResponseAdded` | `RespondToReviewUseCase` | `RecordReviewResponseAddedAuditLogSubscriber`, `NotifyReviewResponseAddedSubscriber` |

All four are dispatched through the existing Module 34 `SynchronousEventBus`
(`infrastructure/events/compose.ts`) — no new event system was introduced.
Subscribers are registered at module-load time from `review/compose.ts`
(audit log) and `notification/compose.ts` (notifications), the exact
pattern every Module 37 subscriber pair already follows (mirrored from
`dispute/compose.ts`/`notification/compose.ts`'s own `DisputeCreated`
wiring).

**`CreateReviewUseCase` was refactored**, not left as Module 13 shipped
it: its old direct `NotificationCreator.notify(...)` call is now
`eventBus.publishAll([new ReviewCreated(...)])`, wrapped in the same
publish-and-report, never-rethrow `try/catch` around `EventDispatchError`
that `CreateDisputeUseCase` established — a failing subscriber (a
notification-service outage, an audit-log write failure) can never roll
back or fail the review itself. This is the one piece of Module 13's own
code this module touched, and only its side-effect wiring — the
eligibility/authorization/duplicate-prevention logic is byte-for-byte
identical to before.

## 8. Notifications

Two `NotificationTypeValue`s are involved:

- `REVIEW_RECEIVED` (Module 13, pre-existing) — now sent by
  `NotifyReviewCreatedSubscriber` reacting to `ReviewCreated`, instead of
  `CreateReviewUseCase` calling `NotificationCreator` directly.
- `REVIEW_RESPONSE_ADDED` (Module 41, new) — sent by
  `NotifyReviewResponseAddedSubscriber` reacting to `ReviewResponseAdded`,
  notifying the original reviewer that the professional replied. Fires on
  every post *and* every edit (an edit could otherwise leave the
  reviewer's copy of the response stale with no signal it changed).

No use case calls `NotificationCreator`/`NotificationService` directly
anywhere in this module — every notification is triggered exclusively
through an event subscriber, per this module's own requirement.

## 9. Audit logs

Four new `AdminAuditAction` values — `REVIEW_CREATED`, `REVIEW_UPDATED`,
`REVIEW_DELETED`, `REVIEW_RESPONSE_ADDED` — added to the existing
`AdminAuditLogRepository`'s union type, each mapped to the closest
existing `AuditLogAction` Prisma enum value (`CREATE`/`UPDATE`/`DELETE`/
`CREATE` respectively) in `PrismaAdminAuditLogRepository`'s
`ADMIN_ACTION_TO_LOG_ACTION` table — the exact "map to the closest
existing enum value, preserve the concrete action in
`metadata.adminAction`" convention every other module's own audit actions
already follow. Distinct from the pre-existing `REVIEW_MODERATED`/
`REVIEW_RESTORED` (Module 16, admin-only actions on `Review.status`) —
Module 41's four new actions are performed by the review's own author or
the reviewed professional, not an admin, reusing the same append-only
trail (the same "generic actor, unified trail" convention
`RecordDisputeCreatedAuditLogSubscriber` already established for
non-admin actors).

## 10. Sentry / failure reporting

Every new event-publishing use case (`CreateReviewUseCase` (refactored),
`UpdateReviewUseCase`, `DeleteReviewUseCase`, `RespondToReviewUseCase`)
takes an optional `FailureReporter` (defaulting to `NullFailureReporter`)
and reports a caught `EventDispatchError` through it — never rethrown,
never bypassed. `review/compose.ts` wires `createFailureReporter()`
(Module 39 — `SentryFailureReporter` in production, `ConsoleFailureReporter`
otherwise), exactly the same as every other module's own composition
root. No new Sentry integration code was written; Module 39's existing
infrastructure is reused as-is.

## 11. API compatibility

- `ReviewRepository`'s existing methods (`findById`, `findByJobId`,
  `listByProfessionalId`, `getProfessionalRatingSummary`, `create`) keep
  their existing signatures. Three new methods (`update`, `softDelete`,
  `respond`) were added; nothing was removed or renamed.
- `ReviewRecord` gained three new fields (`response`, `respondedAt`,
  `deletedAt`) — additive, not breaking; existing code destructuring only
  the pre-Module-41 fields is unaffected.
- `ProfessionalRatingSummary` gained two new fields (`ratingDistribution`,
  `lastReviewAt`) — same additive guarantee.
- `ListProfessionalReviewsOptions` gained one new optional field
  (`rating`) — omitting it is byte-for-byte the pre-Module-41 behavior.
- `CreateReviewUseCase`'s constructor signature changed (an `EventBus` and
  optional `FailureReporter` replace the old `NotificationCreator`
  parameter) — this is application-layer wiring, not a public/repository
  interface, and its `execute(userId, input)` call signature — the actual
  API every Server Action and every test calls — is unchanged.
- No existing Server Action (`createReviewAction`) changed its exported
  signature; three new Server Actions (`updateReviewAction`,
  `deleteReviewAction`, `respondToReviewAction`) were added alongside it.

## 12. Database changes

`Review.response`, `respondedAt`, and `deletedAt` already existed on the
schema (added, unused, by Module 13's own migration — see
`schema.prisma`'s Review model doc comment, which explicitly anticipated
this). **No column changes were needed at all** to add editing, soft
delete, or professional responses.

One new migration,
`prisma/migrations/20260813000000_add_review_response_notification_and_index`:

1. `ALTER TYPE "NotificationType" ADD VALUE 'REVIEW_RESPONSE_ADDED'` —
   the one genuinely new piece of schema this module needs.
2. `CREATE INDEX` for the new composite index described in §5.

Purely additive — no existing column, constraint, index, or migration was
altered. As with every prior migration in this codebase, it is
hand-authored (no live Postgres/Prisma-engine access in this development
sandbox — see §16); the sandbox's own generated Prisma Client `.d.ts`/
`.js` files were hand-patched with the same new `NotificationType` value
so the rest of the codebase type-checks against it locally, but the real
`npx prisma generate`/`npx prisma migrate dev` should still be run against
a live database before merging, per this codebase's own established
caveat (see Module 21/38's own "Validation Results" for the identical,
previously-accepted precedent).

## 13. Performance considerations

- Rating statistics: one `groupBy` query instead of up to seven separate
  queries (§5).
- Public listing/statistics: covered by a single composite index matching
  the exact `WHERE` shape both queries use.
- No new relation is ever loaded eagerly — every repository method keeps
  the existing narrow `DETAIL_SELECT`, now including the three
  previously-unselected columns (`response`, `respondedAt`, `deletedAt`)
  this module's use cases need, and nothing else.
- `update`/`softDelete`/`respond` use `updateMany` (not `update`) so a
  missing id resolves to `count: 0` rather than a thrown Prisma P2025 —
  avoiding an exception-based control-flow path on the (not uncommon,
  given moderation/expiry) "already gone" case.
- No N+1 queries were introduced anywhere in this module.

## 14. Architecture constraints — preserved

- Clean Architecture / DDD boundaries: domain rules live in
  `review-rules.ts` (unchanged location), repository interfaces in
  `domain/repositories/`, use cases orchestrate, `PrismaReviewRepository`
  is the only file that imports `@prisma/client` for Review data.
- Repository Pattern: `ReviewRepository` remains the sole abstraction
  every use case depends on; `PrismaReviewRepository` is still the only
  implementation, swapped for `FakeReviewRepository` in tests.
- Dependency Injection: every new use case takes its dependencies via
  constructor injection, exactly like every existing use case; `review/
  compose.ts` remains the single composition root for this module.
- Domain Events: reuses the existing Module 34 `EventBus`/`DomainEvent`
  base class verbatim — no second event system, no new event-dispatch
  mechanism.
- Existing composition roots / factories: `review/compose.ts` and
  `notification/compose.ts` were extended, not replaced or restructured.
- Existing observability: Module 39's `FailureReporter`
  port/factory is reused as-is.
- No unrelated code was moved, renamed, or refactored. `git status`
  confirms every touched file is either new (this module's own use
  cases/events/subscribers/migration) or a targeted, additive edit to a
  file this module's own requirements directly touch (the Review
  repository/DTO/actions/compose files, the two shared enum-like union
  types `AdminAuditAction`/`NotificationTypeValue` that this module's new
  event subscribers needed a value added to, and the pre-existing
  Review-adjacent test fakes in `analytics`/`gdpr`/`notification` that the
  now-wider `ReviewRepository` interface required updating to keep
  compiling).

## 15. Testing

- `tests/unit/core/domain/review-rules.test.ts` — 14 new unit tests for
  `isWithinReviewEditWindow`, `normalizeResponse`, and
  `emptyRatingDistribution` (13 pre-existing tests for `isValidRating`/
  `normalizeComment` untouched).
- `tests/integration/review/review-flows.test.ts` — 23 new integration
  tests: domain-event dispatch (audit log + notification, per event),
  `UpdateReviewUseCase` (edit window, ownership, rating validation),
  `DeleteReviewUseCase` (soft delete, ownership, "gone from public
  surfaces", idempotency), `RespondToReviewUseCase` (post, edit, cross-
  professional rejection, self-response rejection, empty-response
  rejection, deleted-review rejection), rating-distribution/last-review-
  date statistics, and the new exact-rating listing filter. All 34
  pre-existing Module 13 integration tests are unchanged in substance —
  only `makeUseCases`'s wiring was updated to construct a real
  `SynchronousEventBus` with the real subscribers (mirroring
  `tests/integration/dispute/dispute-flows.test.ts`'s own established
  pattern), since `CreateReviewUseCase`'s constructor now takes an
  `EventBus` instead of a `NotificationCreator`.
- `tests/integration/review/fakes.ts` — `FakeReviewRepository` extended
  with `update`/`softDelete`/`respond` and the new
  `ratingDistribution`/`lastReviewAt` fields; two new fakes added
  (`FakeAdminAuditLogRepository`, `FakeNotificationCreator`) so the
  integration tests can assert on real subscriber side effects.
- Three other modules' own test doubles (`tests/integration/analytics/
  fakes.ts`, `tests/integration/gdpr/fakes.ts`,
  `tests/integration/notification/notification-side-effects.test.ts`)
  needed compatibility updates: their own `FakeReviewRepository` copies
  had to implement the three new `ReviewRepository` methods and the two
  new `ProfessionalRatingSummary` fields to keep satisfying the (widened)
  interface, and one test that constructed `CreateReviewUseCase` directly
  with a `NotificationCreator` was updated to construct a
  `SynchronousEventBus` + `NotifyReviewCreatedSubscriber` instead — same
  reasoning, proving the exact same "notification failure never breaks
  review creation" guarantee one layer out (via `EventDispatchError`,
  never rethrown) rather than via the old direct-call `try/catch`.

Module-scoped test count: **47 → 84** (+37 new tests; +14 unit, +23
integration). No existing test was deleted or weakened; the total test
count strictly increased.

## 16. Validation results

- **TypeScript** (`npm run typecheck`): **PASS** — zero errors across the
  entire codebase.
- **Lint** (`npm run lint`): **PASS** — zero errors/warnings across the
  entire codebase.
- **Tests** (`npm test`): **could not be executed in this sandbox.**
  `vitest`/`vite` requires a native `@rollup/rollup-linux-arm64-gnu`
  binary that is not installed in this development sandbox, and the
  sandbox has no network access to the npm registry to install it
  (`403 Forbidden` — the same class of restriction this codebase's own
  prior modules already documented for the Prisma engine binaries; see
  §12 and Module 21/38's own "Validation Results" for the identical,
  previously-accepted precedent). Every new/changed test file was
  written following this codebase's exact existing conventions (real use
  cases + fake repositories, `SynchronousEventBus` wiring identical to
  `tests/integration/dispute/dispute-flows.test.ts`) and manually
  traced against the implementation; typecheck passing across the whole
  test suite (including every file this module edited) is strong
  corroborating evidence the wiring is correct, but this is not a
  substitute for actually running `npm test` in an environment with
  network access, which should be done before merging.
- **Build** (`npm run build`): **could not be executed in this sandbox.**
  `next build` requires a native `@next/swc-linux-arm64-*` binary, same
  missing-binary/no-registry-access root cause as above.

## 17. Deferred / explicitly out of scope

- Company-side reviewees/responses — `RespondToReviewUseCase` explicitly
  rejects a review with no `revieweeProfessionalProfileId` (a
  company-owned Job's review), mirroring `resolveJobActor`'s own
  documented company-side limitation (Module 13's own "Deferred" section,
  still unresolved).
- A notification to the reviewed professional when their own review is
  edited or deleted by its author — out of scope per this module's own
  event doc comments (`ReviewUpdated`/`ReviewDeleted` are audit-log-only).
- A UI for editing/deleting/responding — this module ships the Server
  Actions and use cases; no page was added or changed (same scope
  discipline Module 13 itself followed for creation).
- Denormalized/cached rating statistics — still computed at read time
  from real rows, now via one efficient query instead of several (§5),
  never a stored/cached aggregate.
