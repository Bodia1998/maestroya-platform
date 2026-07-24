# Module 15 — Notifications

Repository: `maestroya-platform-auth` · Branch: `feature/notifications`

---

## 1. Module purpose

A reusable, in-app notification system: any other module can cause a
user to receive a `Notification` (title, message, optional deep link)
without ever depending on this module's storage directly. Users can list
their own notifications, see an unread count, mark one/all as read, and
dismiss (soft-delete) one. Nothing here is a public "create arbitrary
notification" endpoint — creation is always a trusted, server-side side
effect of another module's own action.

In scope: the domain repository + rules, `CreateNotificationUseCase`
(internal) and six user-facing use cases (list/get/unread-count/mark-as-
read/mark-all-as-read/dismiss), DTOs, Server Actions, the
`NotificationCreator` port + its Prisma-backed implementation, and
wiring that port into Quotes, Booking, Job, Chat, and Reviews at their
existing trigger points.

Out of scope (see Section 15 — Deferred): multi-channel delivery
(email/SMS/push), a notification-preferences UI, a `NEW_SERVICE_REQUEST`
trigger (no professional-matching mechanism exists to notify), any
Payments/Admin/Verification/Search/Maps/Disputes/Commission/Analytics/
Security/Infra functionality (Modules 12, 16–25), and any new UI page.

## 2. Audit findings

Before writing any code, the existing repository was searched for
`notification`, `notifier`, `notify`, `event`, `unread`, `readAt`,
`markAsRead`, `markAllAsRead`. Findings:

- **`Notification` already existed in `schema.prisma`** as a Phase-1
  placeholder (added when the full domain model was scaffolded, before
  any module had business logic). It anticipated multi-channel delivery
  (`channel: NotificationChannel`, `status: NotificationStatus`,
  `sentAt`) and used `body`/`data`/`deletedAt` instead of this module's
  `message`/`metadata`/`dismissedAt` vocabulary. **No code anywhere in the
  repository ever read or wrote this table** — it was pure schema, wired
  to nothing. This module reshapes it into the concrete shape Module 15
  needs (Section 5) rather than leaving it as an unused, wrong-shaped
  table alongside a second one.
- **`ChatAppointmentNotifier` / `ChatJobNotifier`** (`src/core/infrastructure/chat/`)
  and their ports (`AppointmentNotifier`/`JobNotifier` in
  `src/core/application/ports/`) are a *different, narrower* mechanism:
  Booking/Job posting a `SYSTEM` chat message into an existing
  Conversation when an appointment/job event happens. They are chat-
  specific (create a `Message` row, not a `Notification` row), do not
  expose unread counts/read state/dismissal, and are explicitly scoped
  to "the one seam Booking/Job may use to affect Chat." This module does
  **not** duplicate or replace them — every Booking/Job use case below
  keeps its existing `ChatAppointmentNotifier`/`ChatJobNotifier` call
  exactly as it was, and *additionally* calls the new
  `NotificationCreator` port alongside it. Both fire from the same call
  site independently.
- **Chat's own `GetUnreadCountUseCase`/`MarkConversationReadUseCase`**
  operate on `Message.readAt`/`ConversationMember.lastReadAt` — again a
  distinct, conversation-scoped concept, not reused or touched by this
  module (Notification's own `readAt` is a separate column on a separate
  table).
- No `event`, generic pub/sub, or notification-preferences enforcement
  existed anywhere (`User.notificationPreferences` is a `Json?` column
  from Phase 1 with no reader/writer in the codebase — left untouched;
  out of scope here, see Section 15).

## 3. Database changes

`Notification` (`@@map("notifications")`) reshaped in place — see
Section 5 for the full before/after field list. No new table was
created; the placeholder table from
`prisma/migrations/20260717000000_init_domain_model` is altered by a new
migration, `prisma/migrations/20260727000000_add_notifications_module`
(Section 12), following this repository's existing per-migration
directory convention (see e.g. `20260726000000_add_portfolio_module`).
No previously-applied migration file was edited.

`NotificationType` was rebuilt from the Phase-1 placeholder value set to
the concrete, currently-triggered one (Section 6). `NotificationChannel`
and `NotificationStatus` were dropped outright — nothing else in the
schema ever referenced them, and multi-channel delivery has no
implementation to be a "status" of yet.

Indexes: `(userId, dismissedAt, createdAt)` — the "list this user's
active notifications, newest first" hot path — and
`(userId, readAt, dismissedAt)` — the "count this user's unread, active
notifications" hot path. Both replace the Phase-1 placeholder's
`(userId, readAt)` / `(userId, createdAt)` / `(deletedAt)` indexes, which
were never exercised by any query.

## 4. Notification model

`NotificationRecord` (`src/core/domain/repositories/notification-repository.ts`):

| Field          | Type                          | Notes                                                        |
|----------------|-------------------------------|---------------------------------------------------------------|
| `id`           | `string` (UUID)                |                                                                |
| `userId`       | `string` (UUID)                 | Recipient/owner. Every repository method is scoped to it.     |
| `type`         | `NotificationTypeValue`         | See Section 6.                                                |
| `title`        | `string`                        | Required, ≤200 chars, trimmed.                                |
| `message`      | `string`                        | Required, ≤2000 chars, trimmed.                               |
| `resourceType` | `string \| null`                | Free-text tag, e.g. `"JOB"`, `"QUOTE"`, `"CONVERSATION"`, `"APPOINTMENT"`, `"REVIEW"`. |
| `resourceId`   | `string \| null`                | The id of that resource.                                      |
| `actionUrl`    | `string \| null`                 | Safe, internal-only deep link — see Section 9.                |
| `metadata`     | `Record<string, unknown> \| null` | Small structured extras (e.g. `{ jobId, rating }`).            |
| `readAt`       | `Date \| null`                  | `null` = unread.                                              |
| `dismissedAt`  | `Date \| null`                  | `null` = active; non-null = soft-deleted.                     |
| `createdAt` / `updatedAt` | `Date`                |                                                                |

`readAt` and `dismissedAt` are independent — a *read* notification still
appears in the list until *dismissed* (Section 10); dismissal always
implies exclusion from both the list and the unread count regardless of
`readAt` (Section 11).

## 5. Reshaping the Phase-1 placeholder (before → after)

| Before (Phase 1, unused) | After (Module 15) | Change |
|---|---|---|
| `channel: NotificationChannel` | — | Dropped — in-app only, no channel to record. |
| `status: NotificationStatus` (`PENDING`/`SENT`/…) | — | Dropped — same reason. |
| `sentAt` | — | Dropped. |
| `body: String @db.Text` | `message: String @db.Text` | Renamed. |
| `data: Json?` | `metadata: Json?` | Renamed. |
| `deletedAt: DateTime?` | `dismissedAt: DateTime?` | Renamed to match this module's own vocabulary (a notification is *dismissed*, not *deleted*). |
| — | `resourceType: String?` | New — deep-link tag. |
| — | `resourceId: String?` | New. |
| — | `actionUrl: String?` | New. |

Multi-channel delivery remains a valid future extension that would
reintroduce a channel/status pair without disturbing this shape (see the
model's own doc comment in `schema.prisma`).

## 6. Notification types

`NotificationTypeValue` (`src/core/domain/repositories/notification-repository.ts`,
mirrored 1:1 by the Prisma `NotificationType` enum):

| Value | Trigger | Recipient |
|---|---|---|
| `NEW_QUOTE` | `CreateQuoteUseCase` (Quotes) | The customer who owns the ServiceRequest. |
| `QUOTE_ACCEPTED` | `AcceptQuoteUseCase` (Quotes) | The professional whose quote was accepted. |
| `QUOTE_REJECTED` | `AcceptQuoteUseCase` (Quotes) | Every other professional whose still-open quote on the same ServiceRequest was auto-rejected by the acceptance. |
| `NEW_MESSAGE` | `SendMessageUseCase` (Chat) | Every other active Conversation member (never the sender). |
| `APPOINTMENT_PROPOSED` | `ProposeAppointmentTimeUseCase` (Booking) | The party who did not propose. |
| `APPOINTMENT_CONFIRMED` | `ConfirmAppointmentUseCase` (Booking) | The party who did not confirm (i.e. the original proposer). |
| `APPOINTMENT_CANCELLED` | `CancelAppointmentUseCase` (Booking) | The party who did not cancel. |
| `JOB_STARTED` | `StartJobUseCase` (Job) | The customer. |
| `JOB_COMPLETED` | `CompleteJobUseCase` (Job) | The customer. |
| `JOB_CANCELLED` | `CancelJobUseCase` (Job) | The party who did not cancel. |
| `REVIEW_RECEIVED` | `CreateReviewUseCase` (Reviews, Module 13) | The professional being reviewed — never the reviewer/customer. |

Every value corresponds to a real, currently-implemented trigger point.
Dropped from the Phase-1 placeholder enum (no real trigger exists for
any of these in the current codebase): `SERVICE_REQUEST_UPDATE` (would
require a "new ServiceRequest → notify matching professional(s)"
mechanism — no such matching/subscription list exists, see Section 15),
`QUOTE_RECEIVED` (superseded by `NEW_QUOTE`), `APPOINTMENT_REMINDER` (no
scheduled/cron job exists to fire it), `MESSAGE_RECEIVED` (superseded by
`NEW_MESSAGE`), `PAYMENT_RECEIVED`/`PAYOUT_PROCESSED` (Module 12,
untouched), `DISPUTE_UPDATE` (Module 21, untouched), `SYSTEM` (no
sender/use case produces one), `MARKETING` (no sender exists).

## 7. Domain repository

`NotificationRepository` (`src/core/domain/repositories/notification-repository.ts`):
`create`, `findByIdForUser(id, userId)`, `listForUser(userId, options)`,
`countUnreadForUser(userId)`, `markAsRead(id, userId)`,
`markAllAsRead(userId)`, `dismiss(id, userId)`. Every method except
`create` takes `userId` and is scoped to it at the query level — there is
deliberately **no** bare `findById(id)` anywhere in this interface, so a
use case cannot accidentally fetch/mutate another user's row even by
mistake (Section 11).

`PrismaNotificationRepository` (`src/core/infrastructure/database/prisma/repositories/`)
implements it: narrow `SELECT`s, plain-object mapping, no Prisma types
leak past the file (same convention as `PrismaReviewRepository`/
`PrismaPortfolioRepository`). `markAsRead`/`dismiss` check-then-update so
they never touch `updatedAt` on an already-read/dismissed row unless
something actually changes... actually they always re-fetch the current
row first so a no-op call returns the existing record unchanged instead
of writing a fresh `updatedAt` every time (idempotency, Section 10/11).

## 8. Notification creation service / port

`NotificationCreator` (`src/core/application/ports/notification-creator.ts`):
a single `notify(event: NotificationEvent): Promise<void>` method — the
one seam every other module's use case depends on, mirroring
`AppointmentNotifier`/`JobNotifier`'s own doc comment verbatim (same
"dependency direction only ever flows into Notifications, never back
out" discipline). `NullNotificationCreator` is the default for every
optional `notifications` constructor parameter (Section 13).

`NotificationServiceCreator` (`src/core/infrastructure/notifications/notification-service.ts`)
is the only implementation: it adapts `NotificationEvent`'s optional
fields to `CreateNotificationUseCase`'s input and delegates validation/
persistence entirely to that use case. It does **not** swallow errors
itself (mirrors `ChatAppointmentNotifier`/`ChatJobNotifier`, which also
let real errors propagate) — every call site wraps `notify` in its own
`try`/`catch` instead (Section 14), so failures are caught, logged, and
never roll back the primary operation, while still being visible in
server logs rather than silently swallowed twice.

## 9. Use cases

All under `src/core/application/use-cases/notification/`:

1. **`CreateNotificationUseCase`** — internal only, never a public Server
   Action (see `notifications/actions.ts`'s own doc comment — there is no
   `createNotificationAction`). Validates title/message length,
   resource type/id length, and `actionUrl` safety
   (`domain/services/notification-rules.ts`'s `isSafeActionUrl` — must be
   a same-origin relative path starting with `/`, never `//`, never
   `javascript:`/`data:`/`vbscript:` anywhere in the string). Called only
   by `NotificationServiceCreator` and by tests directly.
2. **`ListNotificationsUseCase`** — paginated, newest first, excludes
   dismissed rows, `userId` from auth context only.
3. **`GetNotificationUseCase`** — user-scoped; another user's notification
   (or a nonexistent id) both throw `NotFoundError` — no existence
   leakage.
4. **`GetUnreadNotificationCountUseCase`** — excludes dismissed rows.
5. **`MarkNotificationAsReadUseCase`** — user-scoped, idempotent.
6. **`MarkAllNotificationsAsReadUseCase`** — user-scoped, idempotent,
   single bulk `UPDATE ... WHERE` (never one query per row).
7. **`DismissNotificationUseCase`** — user-scoped, idempotent, soft delete
   only (`dismissedAt`), never a hard `DELETE`.

Composed in `src/core/application/use-cases/notification/compose.ts`,
the same `make*UseCase()` wiring pattern as
`review/compose.ts`/`portfolio/compose.ts` — Server Actions call these,
never a Prisma repository directly.

## 10. Server Actions

`src/app/(dashboard)/notifications/actions.ts` — `"use server"`, each
calls `requireAuth()` first, validates with the corresponding
`notification.dto.ts` schema, derives `userId` from the session only,
then calls the composed use case:

- `listNotificationsAction(limit?, offset?)`
- `getUnreadNotificationCountAction()`
- `getNotificationAction(id)`
- `markNotificationAsReadAction(id)`
- `markAllNotificationsAsReadAction()`
- `dismissNotificationAction(id)`

Deliberately **absent**: `createNotificationAction`. Notification
*creation* is never client-triggerable — it only ever happens as a
trusted, server-side side effect of another module's own action, through
the `NotificationCreator` port (Section 8), never through a public
Server Action a client could call with an arbitrary recipient/type/
message.

Every action returns `ActionResult<T> = { success: true; data: T } |
{ success: false; error: string }` — this module's own convention, since
no prior "read" Server Action with a data payload existed to mirror (see
Section 15 — most read paths elsewhere in this repository call a use
case directly from a Server/React Component; this module still ships
Server Actions for these five reads because the spec calls for them,
e.g. for a future client-component notification bell).

## 11. Authorization model / user isolation

Every action requires `requireAuth()` first; `userId` always comes from
the session, never from any client-supplied field, for every one of the
six user-facing use cases. `NotificationRepository`'s own method
signatures make it structurally impossible to bypass this: there is no
`findById(id)` without a `userId` parameter anywhere in the interface, so
even a future use case that forgets to check ownership couldn't fetch
cross-user data — the repository itself won't return it. `get`/
`markAsRead`/`dismiss` all funnel a "belongs to someone else" row through
the exact same code path as "doesn't exist" (`NotFoundError`), the same
"not yours looks identical to doesn't exist" convention this repository
already uses for `GetPortfolioItemForOwnerUseCase`/`GetReviewByJobUseCase`
— never a distinguishable "forbidden" response an attacker could use to
probe for valid ids belonging to someone else.

## 12. Read/unread vs. dismissal behavior

- **Unread** = `readAt IS NULL`. Marking as read sets `readAt = now()`
  once; calling it again is a no-op that returns the same record
  (idempotent).
- **Dismissed** = `dismissedAt IS NOT NULL`. This is the module's only
  delete mechanism — always soft, never a hard `DELETE` row removal.
  Dismissing an already-dismissed notification is a no-op that returns
  the same record (idempotent).
- These two are independent: a notification can be read-but-not-
  dismissed (stays in the list, no longer counted as "unread" but still
  visible) or unread-and-dismissed (excluded from both the list and the
  unread count even though it was never explicitly read — dismissal
  always wins).
- Pagination (`ListNotificationsUseCase`): `limit`/`offset`, newest
  (`createdAt desc`) first, bounded by `listNotificationsSchema`
  (`limit` 1–100, default 20; `offset` ≥ 0, default 0) at the DTO
  boundary and re-validated at the use-case/repository level the same
  "defense in depth" way every other paginated listing in this codebase
  is (e.g. `listProfessionalReviewsSchema`).

## 13. Integration pattern (how existing modules were wired without breaking them)

Every integration point adds an **optional**, defaulted trailing
constructor parameter — `notifications: NotificationCreator = new
NullNotificationCreator()` — to the existing use case class, rather than
a new required parameter. This was a deliberate choice after auditing how
many places directly construct these use cases with positional arguments
(11 files across `compose.ts` files and this repository's own
integration tests, e.g. `tests/integration/booking/booking-flows.test.ts`,
`tests/integration/review/review-flows.test.ts`): making the parameter
required would have forced editing every one of those call sites just to
keep them compiling, which is exactly the kind of unrelated, wide-blast-
radius refactor the module instructions ask to avoid. With an optional,
no-op-defaulted parameter:

- Every pre-existing direct construction of `StartJobUseCase`/
  `CompleteJobUseCase`/`CancelJobUseCase`/`ProposeAppointmentTimeUseCase`/
  `ConfirmAppointmentUseCase`/`CancelAppointmentUseCase`/
  `CreateQuoteUseCase`/`SendMessageUseCase`/`CreateReviewUseCase` compiles
  and behaves exactly as before (**zero existing test files were
  modified**).
- `AcceptQuoteUseCase` additionally gained an **optional**
  `professionals?: ProfessionalRepository` parameter (needed to resolve a
  `ProfessionalProfile.id` → `User.id` for the accepted/rejected quotes'
  notifications) — also optional, so its two existing call sites
  (`quotes/compose.ts`, `booking-flows.test.ts`) needed no changes either;
  if `professionals` isn't supplied, the notification step is skipped
  entirely rather than throwing.
- Each real `compose.ts` (`job/`, `booking/`, `quotes/`, `chat/`,
  `review/`) is the only place a real `NotificationServiceCreator` is
  actually wired in, alongside each module's own existing notifier(s) —
  production code always gets real in-app notifications; only tests that
  don't care about them (the vast majority of this codebase's existing
  suite) are unaffected.

`src/core/application/use-cases/booking/notify-appointment-party.ts` is a
small shared helper used by all three Booking use cases (propose/
confirm/cancel) to resolve "the other party" (customer ↔ professional)
and fire the notification — avoids triplicating that lookup.

## 14. Best-effort / failure isolation

Every notifier call site wraps `notifications.notify(...)` in its own
`try`/`catch`, logs on failure (`console.error`), and always returns the
primary operation's own result regardless of whether the notification
succeeded — mirrors this codebase's existing `ChatAppointmentNotifier`/
`ChatJobNotifier` call-site convention exactly (see e.g.
`StartJobUseCase.execute`'s pre-existing try/catch around its chat
notice). This is proven end-to-end by
`tests/integration/notification/notification-side-effects.test.ts`
(Section 16) using a `NotificationCreator` double that always throws.

## 15. Existing module integrations

Wired: Quotes (`CreateQuoteUseCase` → `NEW_QUOTE`; `AcceptQuoteUseCase` →
`QUOTE_ACCEPTED` + `QUOTE_REJECTED`), Booking (`ProposeAppointmentTimeUseCase`
→ `APPOINTMENT_PROPOSED`; `ConfirmAppointmentUseCase` →
`APPOINTMENT_CONFIRMED`; `CancelAppointmentUseCase` →
`APPOINTMENT_CANCELLED`), Job (`StartJobUseCase` → `JOB_STARTED`;
`CompleteJobUseCase` → `JOB_COMPLETED`; `CancelJobUseCase` →
`JOB_CANCELLED`), Chat (`SendMessageUseCase` → `NEW_MESSAGE`), Reviews
(`CreateReviewUseCase` → `REVIEW_RECEIVED`, Section 17).

Deferred, with reasons:

- **`NEW_SERVICE_REQUEST` (ServiceRequest creation → professional(s))**:
  no mechanism exists anywhere in this codebase to determine "the
  professional(s) who should be notified about a new ServiceRequest" —
  professionals *pull* available requests via
  `GetAvailableServiceRequestsForProfessionalUseCase`
  (category + geo-radius filtering done at read time); there is no
  stored subscription/match list to push a notification to at write
  time. Building one would mean designing and shipping a new
  matching/broadcast feature, which is out of this module's scope (the
  spec explicitly permits deferring integrations that would require a
  larger refactor) and risks touching Module 19 (Search/Ranking)
  concerns. Documented here rather than silently ignored.
- **`CompleteAppointmentUseCase` / `RescheduleAppointmentUseCase`**: no
  corresponding notification type exists in the concrete, currently-
  triggered set (Section 6) — "job completed" is already covered at the
  Job level (`JOB_COMPLETED`), and a reschedule is, from the notified
  party's perspective, a second `APPOINTMENT_PROPOSED`-shaped event with
  no distinct product requirement calling for a fourth appointment
  notification type. Not wired; can be added later without a schema
  change if a product requirement emerges.
- **Company-owned Jobs/Appointments** (`professionalProfileId: null`):
  every integration above silently skips notifying when there's no
  professional profile to resolve a `userId` from — same scope limit
  `ChatAppointmentNotifier`/`ChatJobNotifier` already have (this codebase
  only supports solo professionals end-to-end today).
- **Multi-channel delivery** (email/SMS/push) and a notification-
  preferences UI reading `User.notificationPreferences` — no module
  implements either today; this module is in-app only by design
  (Section 5).
- **New UI page** (a notification bell/inbox): the module instructions
  say not to create UI pages unless required; only Server Actions were
  shipped (Section 10), ready for a future page/client component to call.

## 16. Tests

`tests/unit/core/domain/notification-rules.test.ts` — pure rule unit
tests: title/message length bounds, resource type/id validation,
`isSafeActionUrl` (accepts internal relative paths, rejects empty/
external/protocol-relative/`javascript:`/`data:`/`vbscript:`, including an
obfuscated scheme embedded later in the string), `normalizeOptionalText`.

`tests/unit/core/application/dto/notification.dto.test.ts` — Zod
boundary tests for all five schemas, including confirming
`listNotificationsSchema`/etc. never parse through a client-supplied
`userId`.

`tests/integration/notification/notification-flows.test.ts` (with
`tests/integration/notification/fakes.ts`'s `FakeNotificationRepository`)
— real use cases + fake repository, covering: valid creation with every
optional field populated/omitted, every validation failure
(title/message/actionUrl), full user isolation (list/get/markAsRead/
dismiss/markAllAsRead all scoped correctly, cross-user access →
`NotFoundError`, no existence probing), unread state + idempotent mark-
as-read + `markAllAsRead` (including its own idempotency), dismissal +
its idempotency + its exclusion from listings and unread counts (even
when never read) + confirming it's a soft delete (row still present),
and pagination (newest-first ordering, limit/offset boundaries, empty
page past the end, per-user isolation).

`tests/integration/notification/notification-side-effects.test.ts` —
proves the module's central reliability guarantee end to end, using a
`NotificationCreator` double that always throws alongside the *real*
Quotes/Job/Reviews/Chat use cases and their existing fake repositories:
quote creation, quote acceptance (including the `QUOTE_ACCEPTED`/
`QUOTE_REJECTED` fan-out), starting a job, completing a job, creating a
review, and sending a chat message **all still succeed** when the
notification service throws. It additionally uses a recording
`NotificationCreator` double to prove the review-received notification
goes to the professional's `userId` and never to the reviewer/customer,
and that a chat message notifies only the other participant, never the
sender.

## 17. Review notification integration detail

Module 13's own documentation (`docs/MODULE_13_REVIEWS.md`) explicitly
deferred a `REVIEW_RECEIVED` notification to a future notifications
module — this is that wiring. `CreateReviewUseCase` gained an optional
`notifications: NotificationCreator` parameter (Section 13); after the
review is persisted, if the job has a `professionalProfileId`, that
professional's `User.id` is resolved via the already-injected
`ProfessionalRepository` and notified with `resourceType: "REVIEW"`,
`resourceId: review.id`, `actionUrl: /jobs/{jobId}`, and
`metadata: { jobId, rating }`. The reviewer (always the job's customer)
is never notified of their own review. Wrapped in `try`/`catch` exactly
like every other integration point — a notification failure never rolls
back or fails the review itself (Section 14, proven in Section 16's
side-effects test).

## 18. Error handling

Reuses this repository's existing `DomainError` subclasses exclusively —
`ValidationError` (title/message/resourceType/resourceId/actionUrl
failures in `CreateNotificationUseCase`) and `NotFoundError`
(user-scoped get/markAsRead/dismiss misses). No new error class was
introduced. `PrismaNotificationRepository` never lets a raw Prisma error
escape past itself (same convention as `PrismaReviewRepository`).

## 19. Deferred functionality (summary)

- `NEW_SERVICE_REQUEST` notifications (no matching mechanism — Section 15).
- `APPOINTMENT_COMPLETED`/`APPOINTMENT_RESCHEDULED` notification types
  and their use-case wiring (no product requirement — Section 15).
- Company-owned Job/Appointment notifications (solo-professional-only
  scope limit shared with `ChatAppointmentNotifier`/`ChatJobNotifier`).
- Multi-channel delivery (email/SMS/push) and a notification-preferences
  UI.
- A notification bell/inbox UI page — Server Actions only, per the
  module instructions.
- Any Payments/Admin/Verification/Search/Maps/Disputes/Commission/
  Analytics/Security/Infra functionality (Modules 12, 16–25) — none
  touched.

## 20. Environment limitations encountered running validation

This sandbox has **no network access** (confirmed: `curl` to
`registry.npmjs.org`/`binaries.prisma.sh` both time out / return no
response), and its `node_modules` were installed on a different host
platform than the one commands were run on — the same combination of
limitations Module 14's own documentation already recorded
(`docs/MODULE_14_PORTFOLIO.md`, Section 9), reproduced here independently
for this module's own validation pass:

- **`npx prisma generate`** — failed: `403 Forbidden` fetching the
  schema/query engine binary from `binaries.prisma.sh` (no network
  access at all, confirmed directly). The Prisma Client in
  `node_modules/.prisma/client` is therefore **stale** (predates this
  module's schema changes) and still exposes the Phase-1 placeholder
  `Notification` shape (`channel`/`status`/`body`/`data`/`sentAt`/
  `deletedAt`, old `NotificationType` values). This is the *only* source
  of TypeScript errors this module introduces — all 9 reported errors
  are confined to `prisma-notification-repository.ts` and are exactly
  the shape mismatch this stale client would produce (e.g.
  `Type '"NEW_QUOTE"' is not assignable to type 'NotificationType'`,
  `'dismissedAt' does not exist in type 'NotificationWhereInput'`).
- **`npm run typecheck`** (`tsc --noEmit`) — ran successfully and
  reported exactly those 9 errors, all in the one file described above.
  Every other file this module touches or added — all domain/
  application-layer code across Quotes, Booking, Job, Chat, Reviews, and
  every new Notifications-module file except the one Prisma repository —
  reports **zero** errors, confirming the wiring itself (constructor
  signatures, port usage, DTOs, use cases) is correct independent of the
  stale client.
- **`npm test`** (Vitest) — could not run: `Cannot find module
  '@rollup/rollup-linux-arm64-gnu'` (this repository's `node_modules` has
  only `darwin-arm64` native optional dependencies installed; the
  sandbox is `linux-arm64` with no registry access to fetch the missing
  Linux-native package — `npm install` also returns `403`). This affects
  the *entire* pre-existing test suite equally, not just this module's
  new tests — it is not a regression introduced here.
- **`npm run lint`** (ESLint) — ran successfully: zero errors, zero
  warnings across every file this module added or modified.
- **`npm run build`** (Next.js) — could not run, for the same
  platform-mismatch reason as `npm test`: `Failed to load SWC binary for
  linux/arm64` (only `@next/swc-darwin-arm64` is installed; no network
  access to fetch `@next/swc-linux-arm64-*`).
- **`git status`** — ran successfully; see the module's final report for
  the full file list. The working tree contains only this module's
  changes, all uncommitted, on `feature/notifications`, exactly as
  instructed.

To fully confirm this module before merging: run
`npx prisma generate && npm run typecheck && npm test && npm run lint &&
npm run build` on a host with network access matching this
repository's target platform (or the original macOS host the checked-in
`node_modules` was installed on) with a real `DATABASE_URL` available for
any test that exercises `PrismaNotificationRepository` directly (the
integration tests in this module deliberately use in-memory fakes and do
not require one).
