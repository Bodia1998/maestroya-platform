# Module 14 — Portfolio

Repository: `maestroya-platform-auth` · Branch: `feature/portfolio`

---

## 1. What this module implements

A professional can showcase previous work as a list of **portfolio
items** attached to their own `ProfessionalProfile` — a title, an
optional description, a media (image) URL, and an optional service
category tag. Customers and the public can list a professional's
portfolio; only the owning professional can create, update, or delete
their own items.

In scope:

- `CreatePortfolioItemUseCase` — the only write path that creates items.
- `UpdatePortfolioItemUseCase` — owner-only update of an existing item.
- `DeletePortfolioItemUseCase` — owner-only soft delete.
- `GetPortfolioItemForOwnerUseCase` — fetch a single item, owner-scoped.
- `ListPortfolioItemsUseCase` — public listing for a professional.
- Server Actions `createPortfolioItemAction` / `updatePortfolioItemAction`
  / `deletePortfolioItemAction`.
- Prisma schema: new `PortfolioItem` model (see Section 5).

Out of scope (see Section 8 — Deferred):

- Portfolio image upload UI/flow (Cloudinary integration for actually
  *uploading* the media file).
- Advanced media galleries, multiple media files per item, video items.
- Portfolio analytics, likes/favorites.
- Customer reviews attached to individual portfolio items.
- Admin moderation of portfolio content.
- Notifications.
- Any Payment/Stripe dependency — Module 12 is deferred and untouched.
- New UI pages — this module ships use cases + Server Actions only, per
  the module instructions ("do not create UI pages unless explicitly
  required").

## 2. Data model

`PortfolioItemRecord` (`src/core/domain/repositories/portfolio-repository.ts`):

| Field                  | Type            | Notes                                             |
|------------------------|-----------------|----------------------------------------------------|
| `id`                   | `string` (UUID) |                                                    |
| `professionalProfileId`| `string` (UUID) | Owner. Never client-settable on create/update.    |
| `serviceCategoryId`    | `string \| null`| Optional tag onto the existing `ServiceCategory`. |
| `title`                | `string`        | 3–120 chars, trimmed.                              |
| `description`          | `string \| null`| Optional, ≤2000 chars, trimmed.                    |
| `mediaUrl`             | `string`        | http(s) URL only.                                  |
| `createdAt`/`updatedAt`| `Date`          |                                                    |

`deletedAt` exists on the underlying Prisma model (soft-delete marker,
same convention as `Address`/`Message`/`ProfessionalProfile`) but is
deliberately **not** part of `PortfolioItemRecord` — every repository read
filters `deletedAt: null`, so a soft-deleted item is invisible to every use
case, the same way a hard-deleted row would be.

## 3. Business rules

Enforced in `domain/services/portfolio-rules.ts`, and re-checked in every
use case (defense in depth — the same "DTO boundary + use case" double
check as `review-rules.ts`/`CreateReviewUseCase`, since use cases are also
called directly by every integration test in this codebase, bypassing the
Zod DTO):

- **Title**: 3–120 characters after trimming (`MIN_TITLE_LENGTH`/
  `MAX_TITLE_LENGTH`).
- **Description**: optional; if present, ≤2000 characters after trimming
  (`MAX_DESCRIPTION_LENGTH`).
- **Media URL**: must parse as an `http:`/`https:` URL — rejects
  `javascript:`, `data:`, relative paths, and malformed strings
  (`isValidMediaUrl`).
- **Service category** (optional): if supplied, must reference an
  *active* `ServiceCategory` (`ServiceCategoryRepository.findActiveByIds`,
  reused as-is from the Professional module) — otherwise
  `ValidationError`.
- Every field is fully resupplied on update — there is no partial-patch
  update, same convention as `UpdateQuoteInput`.

## 4. Authorization model

- **Create**: the caller must have their own `ProfessionalProfile`
  (`professionals.findByUserId(userId)`) with `status === "ACTIVE"` —
  otherwise `ValidationError("You must have an active professional
  profile to manage your portfolio.")`. This is the exact rule and
  message-shape convention `CreateQuoteUseCase`/`UpdateQuoteUseCase`
  already use for "must be an active professional" — a signed-out user
  never reaches this check at all (`requireAuth()` throws
  `UnauthorizedError` first, at the Server Action boundary), and a
  customer (who has no `ProfessionalProfile` row) is rejected identically
  to a suspended professional.
- **Ownership is never client input.** `professionalProfileId` is derived
  exclusively from the authenticated session's `userId` inside the use
  case — there is no `professionalId`/`professionalProfileId` field
  anywhere in `CreatePortfolioItemInput`/`UpdatePortfolioItemInput`, so a
  client cannot create or redirect an item to another professional's
  profile even in principle.
- **Update / Delete / owner-Get**: the target item is looked up by id,
  then its `professionalProfileId` is compared against the caller's own
  resolved profile id. An item that exists but belongs to a *different*
  professional throws the exact same `NotFoundError` a nonexistent id
  would — this is the same "not yours looks identical to doesn't exist"
  convention `UpdateQuoteUseCase`/`WithdrawQuoteUseCase` already use
  elsewhere in this codebase, so no request can be used to probe which
  portfolio-item ids belong to which professional. There is no distinct
  "Forbidden" error class in this codebase (only `UnauthorizedError`,
  reserved for "not signed in" / RBAC role checks) — ownership violations
  on someone else's resource consistently map to `NotFoundError`
  throughout this repository, and Module 14 follows that exact
  convention rather than introducing a new error shape.
- **Public reads**: `ListPortfolioItemsUseCase` requires no authentication
  at all — mirrors `ListProfessionalReviewsUseCase`'s own doc comment
  (a professional's portfolio, like their profile and published reviews,
  is public marketing data). Every field on `PortfolioItemRecord` is safe
  to expose publicly; there is no separate "internal-only" projection.
- **Isolation**: `listByProfessionalId` always scopes its query to exactly
  one `professionalProfileId` — one professional's items never appear in
  another's listing (covered by an integration test, Section 6).

## 5. Database changes (audit result)

No `Portfolio`/`PortfolioItem` model existed anywhere in `schema.prisma`
before this module — this is a net-new table, not a completion of a
partial/stub model.

Added:

- **`PortfolioItem` model** (`@@map("portfolio_items")`):
  - `professionalProfileId` (`UUID`, required) → FK to
    `ProfessionalProfile`, **`onDelete: Cascade`** — a portfolio item has
    no reason to outlive the professional profile that owns it, the same
    convention as `CompanyMember` → `CompanyProfile` (both are "wholly
    owned child rows of exactly one parent, referenced by nothing else").
  - `serviceCategoryId` (`UUID`, optional) → FK to `ServiceCategory`,
    **`onDelete: SetNull`** — purely descriptive; unlike
    `ServiceRequest.categoryId` (`Restrict`, load-bearing for matching/
    history), a deprecated category must never block a professional from
    managing their own portfolio.
  - `title` (`String`), `description` (`String?`, `@db.Text`), `mediaUrl`
    (`String`).
  - `deletedAt` (`DateTime?`) — soft-delete marker, same convention as
    `Address`/`Message`/`ProfessionalProfile`.
  - `createdAt`/`updatedAt`.
  - Indexes: composite `(professionalProfileId, deletedAt, createdAt)` —
    covers this module's one hot read path ("list this professional's
    non-deleted items, newest first"); plus `(serviceCategoryId)`.
- Back-relations added: `ProfessionalProfile.portfolioItems` and
  `ServiceCategory.portfolioItems`.

No existing model was modified beyond adding these two back-relation
fields (required by Prisma for a relation to compile) — no column was
renamed, dropped, or had its type/nullability changed on any pre-existing
table.

Migration: `prisma/migrations/20260726000000_add_portfolio_module`
(hand-authored — no live Postgres/Prisma-engine access in the sandbox
this module was developed in; the exact same caveat every prior migration
in this repository already carries, see Section 9). Since
`portfolio_items` is a brand-new table, there are no pre-existing rows to
backfill or migrate.

## 6. Tests

`tests/unit/core/domain/portfolio-rules.test.ts` — pure business-rule
unit tests: title length bounds, description length bound, media URL
scheme validation (accepts http(s), rejects `javascript:`/`data:`/
relative paths/malformed strings), optional-text normalization.

`tests/unit/core/application/dto/portfolio.dto.test.ts` — Zod DTO
boundary tests for `createPortfolioItemSchema`/`updatePortfolioItemSchema`/
`listPortfolioItemsSchema`, including confirming no
`professionalId`/`professionalProfileId` field is ever parsed through.

`tests/integration/portfolio/portfolio-flows.test.ts` — real use cases +
domain services, in-memory fake repositories (`tests/integration/portfolio/fakes.ts`)
swapped in for storage, same pattern as `review-flows.test.ts`/
`quote-flows.test.ts`. Covers every scenario the module's authorization
and business rules require:

- Authenticated, active professional can create a portfolio item.
- A user with no professional profile (customer/non-professional) cannot
  create one (`ValidationError`).
- A suspended/inactive professional cannot create one.
- A portfolio item is always associated with the *authenticated*
  professional — never a client-supplied id.
- Title/description/media-URL/service-category validation failures are
  all rejected (`ValidationError`).
- The owner can update their own item; `professionalProfileId` cannot be
  changed via update.
- A professional cannot update or delete another professional's item
  (`NotFoundError`).
- The owner can delete their own item; it disappears from listings and
  becomes unreachable (get/update/delete) afterward.
- Deleting/updating a nonexistent item returns `NotFoundError`.
- Listing returns only the selected professional's portfolio, newest
  first, and is fully isolated between professionals (one professional's
  items never leak into another's listing).
- Listing a professional with zero items returns an empty array, not an
  error.

Unauthenticated access is covered by the existing, generic
`tests/unit/core/infrastructure/auth/rbac.test.ts` (`requireAuth` throws
`UnauthorizedError` when signed out) — every Portfolio Server Action calls
`requireAuth()` before it ever reaches a use case, so no separate
per-module "unauthenticated" test was duplicated; this exactly mirrors how
`reviews/actions.ts`/`dashboard/professional/actions.ts` are already
covered in this codebase (no module has its own `actions.ts`-level test
file — only `rbac.test.ts` does).

**Existing modules remain unaffected**: `npx tsc --noEmit` across the
*entire* repository (not just the new files) reports zero errors outside
the five lines in `prisma-portfolio-repository.ts` that reference the
not-yet-regenerated Prisma client (see Section 9) — no other module's
types, tests, or files were touched.

## 7. API / Server Action boundaries

Mutations only go through Server Actions, reads go through use cases
called directly (the existing convention — see e.g.
`(marketing)/professionals/[id]/page.tsx` calling
`ListProfessionalReviewsUseCase` directly, no Server Action wrapper for
reads):

- `createPortfolioItemAction(formData)` — `"use server"`,
  `src/app/(dashboard)/dashboard/professional/portfolio/actions.ts`.
- `updatePortfolioItemAction(portfolioItemId, formData)` — same file.
- `deletePortfolioItemAction(portfolioItemId)` — same file.
- `makeListPortfolioItemsUseCase()` / `makeGetPortfolioItemForOwnerUseCase()`
  — exported via `src/core/application/use-cases/portfolio/compose.ts`
  for a future page/route to call directly, same wiring convention as
  every other module's `compose.ts`.

No page/route was added or changed — the module instructions explicitly
say not to create UI pages unless required, and none of Module 14's
requirements call for one.

## 8. Deferred / explicitly out of scope

- Portfolio image upload UI/flow. `mediaUrl` is a plain URL string; no new
  media-storage abstraction was introduced. When an upload flow is
  eventually built, it can reuse the existing Cloudinary adapter
  (`src/core/infrastructure/storage/cloudinary`) exactly the way
  `CloudinaryRequestPhotoUploadService` already does for service-request
  photos, and hand this field the resulting `secure_url` — no schema
  change required.
- Advanced media galleries / multiple media files per item / video
  portfolio items.
- Portfolio analytics.
- Likes/favorites.
- Customer reviews attached to individual portfolio items.
- Admin moderation of portfolio content.
- Notifications on portfolio create/update/delete.
- Any Payment/Stripe Connect dependency (Module 12) — none introduced;
  Portfolio works entirely independently of it.
- UI/pages.

## 9. Environment limitations encountered

- `npx prisma generate` could not be run in this sandbox: the sandbox has
  no network access to Prisma's binary CDN (`binaries.prisma.sh` — 403,
  blocked by allowlist) to download the `linux-arm64` schema/query engine.
  As a direct consequence, the generated Prisma Client in `node_modules`
  is stale (predates this module) and does not expose a `portfolioItem`
  delegate, which is the *only* source of TypeScript errors this module
  introduces (5 lines in `prisma-portfolio-repository.ts`, all
  `Property 'portfolioItem' does not exist on type 'PrismaClient'`).
  Running `npx tsc --noEmit` across the rest of the repository (excluding
  those 5 lines) reports zero errors. Run `npx prisma generate` in an
  environment with network access (or against the checked-in
  `node_modules`'s original macOS host) before relying on this module at
  runtime.
- `npm test` (Vitest) and `npm run build` (Next.js) could not be run
  either, for an unrelated reason: this repository's `node_modules` was
  installed on a macOS (`darwin-arm64`) host and only contains
  `darwin-arm64` native optional dependencies (`@next/swc-darwin-arm64`,
  no `@rollup/rollup-linux-*` at all). The sandbox is Linux (`linux-arm64`)
  with no registry access to fetch the missing Linux-native packages
  (`npm install` also returns 403, blocked by allowlist). This affects
  *every* module in this repository equally, not just Module 14 — it is
  not a regression introduced here.
  - What *was* verified instead: `npx eslint` on every new file (zero
    warnings/errors) and `npx tsc --noEmit` across the whole repository
    (zero errors outside the Prisma-client staleness noted above). The
    new integration/unit test files
    (`tests/integration/portfolio/portfolio-flows.test.ts`,
    `tests/unit/core/domain/portfolio-rules.test.ts`,
    `tests/unit/core/application/dto/portfolio.dto.test.ts`) follow this
    repository's exact existing test conventions (fakes implementing the
    real repository interfaces, Vitest `describe`/`it`), so they are
    expected to pass once run in an environment where `npm test` itself
    works — but this could not be executed and confirmed in this sandbox.
  - Run `npm run prisma:generate && npm test && npm run build` on a
    Linux-native `npm install` (or on the original macOS host) to confirm
    before merging.

## 10. Confirmation

No Stripe/Payment functionality was added, modified, or introduced as a
dependency anywhere in this module. `src/core/infrastructure/payments/`
and Module 12 were not touched.
