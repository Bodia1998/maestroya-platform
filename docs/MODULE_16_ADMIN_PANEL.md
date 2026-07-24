# Module 16 — Admin Panel

Repository: `maestroya-platform-auth` · Branch: `feature/admin-panel`

---

## 1. Module purpose

An internal back-office area for authorized platform administrators.
Provides operational oversight — not a second business-logic
implementation — across every existing module: an admin dashboard with
platform-wide counts, user management (list/search/suspend/reactivate/
role change), read-only professional/service-request/quote/appointment-
job oversight, review and portfolio moderation, an admin-safe
notification operational overview, and an append-only audit trail of
every sensitive admin mutation.

Out of scope (see Section 24 — Deferred): professional verification,
company professional management, search/ranking, maps/geolocation,
disputes/support, commission/financial logic, a dedicated analytics
module, a dedicated security/anti-abuse module, and production
infrastructure.

## 2. Audit findings

Before writing any code, the repository was audited for `requireAuth`,
`requireRole`, `role`, `ADMIN`, `Forbidden`, `UnauthorizedError`,
`NotFoundError`, `ValidationError`, `audit`, `moderation`, `soft
delete`/`deletedAt`, `suspended`, `status`, `notification`, and Modules
13–15's implementations. Key findings, each of which shaped what this
module did and did not add:

- **An `ADMIN` role (and `SUPER_ADMIN`) already existed** in
  `src/core/infrastructure/auth/rbac.ts`'s `ROLES` constant and in
  `prisma/seed.ts`'s seeded `Role` rows, with a bootstrap admin account
  (`admin@maestroya.es`) already assigned it. `requireAuth()` and
  `requireRole(...allowed)` already existed and already throw
  `UnauthorizedError` — this module reuses both exactly as-is; no new
  auth mechanism was introduced.
- **`middleware.ts` already had an `/admin` role gate** (`{ prefix:
  "/admin", roles: ["ADMIN", "SUPER_ADMIN"] }`), added by the
  Authentication module specifically "ready for when those routes
  exist" (see that file's own comment). This module is exactly that —
  the UI routes below live at `/admin/*` for this reason.
- **`AuditLog` already existed** in `schema.prisma` ("Platform / Audit"
  section) as a general-purpose, append-only, polymorphic
  (`entityType`/`entityId`) audit trail with `actorUserId`, `action`
  (`AuditLogAction` enum), `metadata` (JSON), and `createdAt` — but **no
  repository or use case anywhere wrote to it**. This module is the
  first to use it; no new `AdminAuditLog` table was created.
- **`User.status` (`UserStatus`: `PENDING_VERIFICATION` / `ACTIVE` /
  `SUSPENDED` / `BANNED` / `DEACTIVATED`) already existed.** No schema
  change was needed for suspend/reactivate.
- **`Review.status` (`ReviewStatus`: `PENDING` / `PUBLISHED` / `FLAGGED`
  / `REMOVED`) already existed**, and its own doc comment in
  `schema.prisma` explicitly says "the enum itself is left untouched so
  Module 16 can later flag/remove a review... without a schema change."
  `PrismaReviewRepository`'s public listing/rating-aggregation queries
  already filter to `PUBLISHED` only. No schema change was needed for
  review moderation.
- **`PortfolioItem` had no moderation concept** — only `deletedAt`
  (the owner's own soft delete, Module 14). This is the one schema
  change this module makes (Section 15).
- Modules 13/14/15 (Reviews, Portfolio, Notifications) all follow the
  same layered convention: a narrow domain repository interface + a
  Prisma implementation + Zod DTOs + use cases + a composition root +
  thin Server Actions. This module follows the same shape.

## 3. Existing RBAC/authentication model

`src/core/infrastructure/auth/rbac.ts`:

- `getCurrentUser()` reads the Auth.js session (`auth()`) and returns
  `{ id, email, roles }` or `null`.
- `requireAuth()` throws `UnauthorizedError` if nobody is signed in.
- `requireRole(...allowed: RoleKey[])` calls `requireAuth()` then throws
  `UnauthorizedError` if the caller holds none of `allowed`.

`ROLES` includes `ADMIN`, `SUPER_ADMIN`, `SUPPORT`, `CUSTOMER`,
`PROVIDER`, `MODERATOR` — sourced from the seeded `Role` table via
`UserRole`. This module uses `requireRole(ROLES.ADMIN,
ROLES.SUPER_ADMIN)` everywhere and introduces no second role/permission
concept.

## 4. Admin authorization model

Every Admin Panel Server Action in `src/app/(dashboard)/admin/actions.ts`
starts with `const admin = await requireRole(ROLES.ADMIN,
ROLES.SUPER_ADMIN)` before doing anything else — unauthenticated callers
get `UnauthorizedError` from `requireAuth()` inside `requireRole`;
authenticated non-admins get the same `UnauthorizedError` from the role
check itself (the codebase has one auth error class, not a separate
"Forbidden," so this is the existing convention's equivalent). The admin
actor's id used for every mutation and every audit log entry is always
`admin.id` — the value `requireRole()` resolved from the session — never
a client-supplied field. No DTO in `admin.dto.ts` has an `adminUserId`,
`actorId`, `role`, or `isAdmin` field; see the DTO/test files for
explicit assertions of this. `AdminLayout`
(`src/app/(dashboard)/admin/layout.tsx`) additionally redirects a
non-admin/unauthenticated request at the page level, on top of
`middleware.ts`'s existing `/admin` role gate — three independent layers
(middleware, layout, Server Action) each enforce the same rule.

## 5. Admin dashboard overview

`GetAdminDashboardOverviewUseCase` → `AdminRepository.getDashboardOverview()`
returns one object of plain counts (`totalUsers`, `totalProfessionals`,
`totalServiceRequests`, `totalQuotes`, `totalAppointments`, `totalJobs`,
`totalReviews`, `totalPortfolioItems`, `totalNotifications`,
`unreadNotifications`), computed via `Promise.all` of `prisma.*.count()`
aggregate queries — no N+1, no charts, no trends. Rendered at `/admin`.

## 6. User management

`ListAdminUsersUseCase`/`GetAdminUserUseCase` back `/admin/users` —
paginated (bounded `limit`/`offset`), searchable by name/email substring.
Each row's safe projection (`AdminUserRecord`) includes status, roles,
and `hasProfessionalProfile` — never `passwordHash` or any token.
`SuspendAdminUserUseCase`/`ReactivateAdminUserUseCase` move
`User.status` between `ACTIVE` and `SUSPENDED`/`DEACTIVATED` only
(never `BANNED` — a deliberately heavier, out-of-scope escalation) and
refuse to suspend the last remaining `ACTIVE` admin
(`AdminRepository.countActiveAdmins()`). `ChangeUserRoleUseCase`
replaces a user's role set, validates every key against the live `Role`
table, and refuses a change that would leave zero active admins. All
three mutations write an audit log entry.

## 7. Professional management

`ListAdminProfessionalsUseCase`/`GetAdminProfessionalUseCase` back
`/admin/professionals` — paginated, searchable by business/owner
name/email, showing status, the existing `verificationStatus` (read-only
display only — no transition), rating summary, and portfolio item count.
No verification workflow, no suspension UI beyond what already exists on
`ProfessionalProfile.status` (this module does not add one — see
Section 24).

## 8. Service request oversight

`ListAdminServiceRequestsUseCase`/`GetAdminServiceRequestUseCase` back
`/admin/service-requests` — paginated, filterable by
`ServiceRequestStatus`, showing owner/quote-count/job-count. Strictly
read-only: no mutation use case or Server Action exists for
ServiceRequest.

## 9. Quote oversight

`ListAdminQuotesUseCase`/`GetAdminQuoteUseCase` back `/admin/quotes` —
paginated, filterable by `QuoteStatus`. Strictly read-only.

## 10. Appointment/job oversight

`ListAdminJobsUseCase`/`GetAdminJobUseCase` back `/admin/jobs` —
paginated, filterable by `JobStatus`, showing the appointment count per
Job (Job is the authoritative execution-lifecycle record — see
`schema.prisma`'s own doc comment). Strictly read-only.

## 11. Review moderation

`ModerateReviewUseCase` sets `Review.status = REMOVED`;
`RestoreReviewUseCase` sets it back to `PUBLISHED`. No schema change was
needed (Section 2). `PrismaReviewRepository.listByProfessionalId` and
`getProfessionalRatingSummary` already filter to `PUBLISHED` only, so a
moderated review disappears from every public surface immediately with
no further change. Both mutations write an audit log entry with an
optional free-text reason. `/admin/reviews` lists every status
(including `FLAGGED`/`REMOVED`) with hide/restore actions.

## 12. Portfolio moderation

`PortfolioItem.moderatedAt` (new nullable `DateTime` column, see Section
15) is set/cleared by `ModeratePortfolioItemUseCase`/
`RestorePortfolioItemUseCase` — deliberately separate from Module 14's
own `deletedAt` (owner-driven soft delete). `PrismaPortfolioRepository
.listByProfessionalId` (the query backing both the public professional-
profile listing and the owner's own dashboard listing — see that file's
doc comment) now also filters `moderatedAt: null`, so a moderated item
disappears from both immediately. `/admin/portfolio` lists every item
(visible, admin-hidden, and owner-deleted) with hide/restore actions
(disabled for owner-deleted items).

## 13. Notification handling

Deliberately minimal, per the module spec's explicit boundary: the
dashboard overview exposes only two aggregate numbers
(`totalNotifications`, `unreadNotifications`, both platform-wide
`prisma.notification.count()` calls). No admin "view all notifications"
feature, no per-user notification browsing, and no way for an admin to
mark another user's notification as read exists anywhere in this module
— Module 15's user-scoped isolation (`NotificationRepository`'s
`userId`-scoped methods) is untouched and un-bypassed.

## 14. Audit logging

`AdminAuditLogRepository` (`src/core/domain/repositories/admin-audit-log-repository.ts`)
is backed by the existing `AuditLog` table
(`PrismaAdminAuditLogRepository`) — no new table. Each admin action maps
to the closest existing `AuditLogAction` enum value (`STATUS_CHANGE` for
suspend/reactivate, `UPDATE` for role changes and moderation), with the
precise action name (`USER_SUSPENDED`, `USER_REACTIVATED`,
`USER_ROLE_CHANGED`, `REVIEW_MODERATED`, `REVIEW_RESTORED`,
`PORTFOLIO_ITEM_MODERATED`, `PORTFOLIO_ITEM_RESTORED`) preserved in
`metadata.adminAction`. `record()` is the only write method — there is
no `update`/`delete` on the interface (asserted by a test), matching
`AuditLog`'s own "no updatedAt, no soft delete" design. `/admin/audit-logs`
is a read-only, paginated view (`ListAdminAuditLogsUseCase`).

## 15. Database changes

One additive, nullable column:

```sql
ALTER TABLE "portfolio_items" ADD COLUMN "moderatedAt" TIMESTAMP(3);
CREATE INDEX "portfolio_items_moderatedAt_idx" ON "portfolio_items"("moderatedAt");
```

Migration directory: `prisma/migrations/20260728000000_add_admin_panel_portfolio_moderation/`
(hand-authored, matching every prior migration's own "no DB/network
access in this environment" caveat — see Section 25). Nothing existing
was renamed, dropped, or made backward-incompatible. No other model was
touched.

## 16. Domain repositories

- `src/core/domain/repositories/admin-repository.ts` — one broad
  `AdminRepository` interface covering every read/write this module
  needs across User/ProfessionalProfile/ServiceRequest/Quote/Job/Review/
  PortfolioItem. Deliberately not eight narrow per-aggregate
  repositories (this codebase's usual convention) — see the file's own
  doc comment for why: the Admin Panel is a cross-aggregate oversight
  layer, and most of what it reads (aggregate counts, joined
  owner/customer names, cross-entity counts) has no equivalent in any
  existing narrow repository. It never reimplements
  quote/job/appointment/booking business rules — every list method is
  read-only projection; the only mutations are `setUserStatus`,
  `setUserRoles`, `setReviewStatus`, `setPortfolioItemModeratedAt`.
- `src/core/domain/repositories/admin-audit-log-repository.ts` — see
  Section 14.
- `src/core/infrastructure/database/prisma/repositories/prisma-admin-repository.ts`
  and `prisma-admin-audit-log-repository.ts` — Prisma implementations.
- `src/core/infrastructure/database/prisma/repositories/prisma-portfolio-repository.ts`
  — one-method edit (Section 12); Module 14's other files are untouched.

## 17. Application use cases

`src/core/application/use-cases/admin/`:
`GetAdminDashboardOverviewUseCase`, `ListAdminUsersUseCase`,
`GetAdminUserUseCase`, `SuspendAdminUserUseCase`,
`ReactivateAdminUserUseCase`, `ChangeUserRoleUseCase`,
`ListAdminProfessionalsUseCase`, `GetAdminProfessionalUseCase`,
`ListAdminServiceRequestsUseCase`, `GetAdminServiceRequestUseCase`,
`ListAdminQuotesUseCase`, `GetAdminQuoteUseCase`, `ListAdminJobsUseCase`,
`GetAdminJobUseCase`, `ListAdminReviewsUseCase`, `ModerateReviewUseCase`,
`RestoreReviewUseCase`, `ListAdminPortfolioItemsUseCase`,
`ModeratePortfolioItemUseCase`, `RestorePortfolioItemUseCase`,
`ListAdminAuditLogsUseCase`, plus `compose.ts` (the composition root,
same "one shared Prisma repository instance, one factory per use case"
convention as `notification/compose.ts`).

## 18. Server Actions

`src/app/(dashboard)/admin/actions.ts` — one file (matches the existing
one-`actions.ts`-per-module convention), all `"use server"`. Reads:
`getAdminDashboardOverviewAction`, `listAdminUsersAction`,
`listAdminProfessionalsAction`, `listAdminServiceRequestsAction`,
`listAdminQuotesAction`, `listAdminJobsAction`, `listAdminReviewsAction`,
`listAdminPortfolioItemsAction`, `listAdminAuditLogsAction`. Mutations:
`suspendUserAction`, `reactivateUserAction`, `changeUserRoleAction`,
`moderateReviewAction`, `restoreReviewAction`,
`moderatePortfolioItemAction`, `restorePortfolioItemAction`. Every
action: `requireRole()` → Zod-validate input → call a composed use case
with the session-derived admin id → translate the result/error into the
shared `ActionResult<T>` shape, never a raw Prisma/DB error.

## 19. UI routes/pages

All under `src/app/(dashboard)/admin/` (resolves to `/admin/*`, matching
`middleware.ts`'s existing role gate): `layout.tsx` (role guard + nav),
`page.tsx` (`/admin` — dashboard), `users/page.tsx`,
`professionals/page.tsx`, `service-requests/page.tsx`, `quotes/page.tsx`,
`jobs/page.tsx`, `reviews/page.tsx`, `portfolio/page.tsx`,
`audit-logs/page.tsx`. Every list page paginates via `?page=`, shows a
safe empty state, and — for users/reviews/portfolio, the three
aggregates with mutations — a plain HTML `<form action={...}>` per row
invoking the corresponding Server Action directly (no client-side JS
framework beyond what the codebase already uses). Read-only pages
(professionals, service requests, quotes, jobs, audit logs) render a
plain table with no mutation controls.

## 20. Security and user isolation

- No Admin Panel Server Action or page trusts a client-supplied
  `userId`/`adminUserId`/`role`/`isAdmin` for authorization — the
  authenticated session (`requireRole()`) is the only source of truth;
  every mutation's actor id comes from that call's return value, never
  from `FormData`/DTO input (verified by tests in
  `tests/integration/admin/admin-flows.test.ts`, "Security" section).
- `AdminUserRecord` never includes `passwordHash` or any auth token
  (verified by a test).
- Suspend/reactivate/role-change protect against removing the last
  active admin (`countActiveAdmins()`), so the platform can never be
  left with zero admins able to reverse a mistake.
- Notification content stays fully user-isolated — see Section 13.
- Every `NotFoundError` is thrown identically whether a target id
  doesn't exist or (where relevant) belongs to a different aggregate —
  no existence probing.

## 21. Error handling

Reuses the existing `DomainError` hierarchy exclusively:
`UnauthorizedError` (no session / wrong role), `NotFoundError` (missing
target), `ValidationError` (bad state transition, unknown role key),
`ConflictError` (last-admin protection). No new error class was added.
Every Server Action's `catch` block translates a `DomainError` into its
own safe message and anything else into a generic fallback after
`console.error` — no raw Prisma error ever crosses the action boundary
(same `fromDomainError` pattern as every other module's `actions.ts`).

## 22. Tests

- `tests/unit/core/domain/admin-rules.test.ts` — `isSuspendableStatus`,
  `isReactivatableStatus`, `normalizeModerationReason`.
- `tests/unit/core/application/dto/admin.dto.test.ts` — pagination
  bounds, search length, status-filter enums, role-key validation,
  moderation-reason length, and that no schema accepts an
  `adminUserId`/`role`/`isAdmin` field.
- `tests/integration/admin/fakes.ts` — in-memory `FakeAdminRepository`/
  `FakeAdminAuditLogRepository` implementing the real interfaces.
- `tests/integration/admin/admin-flows.test.ts` — auth boundary
  (unauthenticated/customer/professional rejected, admin accepted);
  user list/paginate/search/view/suspend/reactivate/role-change
  (including last-admin protection); professional
  list/paginate/search; service-request/quote/job list + status
  filters; review list/moderate/restore (+ the
  moderated-status-excluded-from-public-listing contract); portfolio
  list/moderate/restore (+ moderation kept separate from `deletedAt`);
  audit log entries carry the correct authenticated admin id and the
  log is read-only/append-only; security assertions (no
  client-suppliable admin identity, no sensitive fields returned).
- All existing test suites (auth, booking, chat, discovery, job,
  notification, portfolio, professional, profile, quotes, review,
  service-request) were left untouched — only one method
  (`PrismaPortfolioRepository.listByProfessionalId`) in existing
  production code changed, and it is additive (adds a filter clause,
  does not change the return shape).

## 23. Validation results

See the final report for exact command output. Summary: `prisma
generate` cannot download platform engine binaries in this sandbox
(outbound network to `binaries.prisma.sh` is blocked by an allowlist
proxy — confirmed via direct `curl`, independent of this module's code);
the previously-generated Prisma Client's TypeScript types were
hand-patched to add the new `PortfolioItem.moderatedAt` field so
`typecheck`/`build` reflect the schema change (see Section 25) — a real
`npx prisma generate` run on a machine with network access will
regenerate the same types from `schema.prisma` and should be run before
merging.

## 24. Deferred functionality

- Professional verification workflow → **Module 17**.
- Company professional management → **Module 18**.
- Search/ranking → **Module 19**.
- Maps/geolocation → **Module 20**.
- Disputes/support → **Module 21**.
- Commission/financial logic → **Module 22**.
- A dedicated Analytics module (charts, trends, cohort/financial
  reporting) → **Module 23**. This module's dashboard is operational
  counts only, by design.
- A dedicated Security/Anti-abuse module → **Module 24**.
- Production infrastructure → **Module 25**.
- Not implemented within Module 16 itself (explicitly out of the
  minimum-required scope): a one-click role-change UI control (the
  `changeUserRoleAction`/`ChangeUserRoleUseCase` fully exist and are
  tested — only the `/admin/users` page's UI doesn't yet expose a role
  picker); user hard deletion (never added — the existing model has no
  safe destructive-deletion concept for `User`, and the spec says not to
  invent one); `BANNED` as an admin-reachable state (deliberately a
  heavier action left for a future, more deliberate workflow).

## 25. Environment limitations

- **No outbound network access to `binaries.prisma.sh`** in this
  sandbox (`403 Forbidden`, confirmed by direct `curl` — an allowlist
  proxy, not a code issue). `npx prisma generate` and `npx prisma
  migrate` cannot download the Linux engine binaries here, so neither
  could be run end-to-end. The migration SQL was hand-authored instead
  (matching every prior migration in this repo, which carry the same
  caveat — see e.g. `20260723000000_add_appointment_pending_schedule/migration.sql`).
  The already-generated Prisma Client in `node_modules/.prisma/client`
  (produced on a different host before this sandbox) was hand-patched
  to add the `moderatedAt` field's types so this module's code
  typechecks against it; this is not a substitute for running the real
  generator, which should happen in CI/on a developer machine with
  network access.
- **No live Postgres connection** in this sandbox — `DATABASE_URL`
  points at `localhost:5432`, which is not running here. The migration
  could not be applied, and `prisma migrate status` could not be run.
