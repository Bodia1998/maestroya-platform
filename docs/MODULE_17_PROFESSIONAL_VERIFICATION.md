# Module 17 — Professional Verification

## Purpose & Scope

An explicit, admin-reviewed identity/trust verification workflow for individual
professionals. A professional assembles a verification **case**, uploads
documents, and submits it for review; an ADMIN/SUPER_ADMIN reviews it and
approves, rejects, or requests a resubmission. On approval the professional
earns a public **“Verified professional”** badge.

In scope: the verification case lifecycle, document upload/removal, the admin
review queue + decisions, server-side authorization, audit logging,
notifications, and the public verified indicator.

Out of scope (deferred — see the bottom of this doc): company verification,
Stripe/payments, search ranking, maps, disputes, analytics, and any new
security/anti-abuse module.

## Architecture

Follows the existing clean-architecture layering used by every other module:

- **Domain**
  - `domain/services/professional-verification-rules.ts` — pure state-machine
    and validation rules (no dependencies), the single source of truth for
    transitions, document requirements and reason limits.
  - `domain/repositories/professional-verification-repository.ts` — the
    repository interface + record shapes.
- **Application**
  - `application/dto/verification.dto.ts` — Zod schemas for the Server Action
    boundary.
  - `application/interfaces/verification-document-upload-service.ts` — upload
    port.
  - `application/use-cases/verification/*` — 12 use cases + `compose.ts`.
- **Infrastructure**
  - `infrastructure/database/prisma/repositories/prisma-professional-verification-repository.ts`
  - `infrastructure/storage/cloudinary/verification-document-upload-service.ts`
- **Delivery (Next.js App Router)**
  - Professional: `src/app/(dashboard)/dashboard/professional/verification/`
  - Admin: `src/app/(dashboard)/admin/verifications/`

Reused, not duplicated: RBAC (`infrastructure/auth/rbac.ts`), the append-only
`AuditLog` via `AdminAuditLogRepository`, the Cloudinary client, the Prisma
client singleton, the `NotificationCreator` port + `NotificationServiceCreator`,
the shared domain error classes, and the public `VerificationBadge`.

## Database Changes

New migration: `prisma/migrations/20260729000000_add_professional_verification_module/migration.sql`
(no existing migration was edited).

- **Enum `ProfessionalVerificationStatus`**: `DRAFT`, `PENDING`,
  `UNDER_REVIEW`, `APPROVED`, `REJECTED`, `RESUBMISSION_REQUIRED`, `EXPIRED`.
  `DRAFT` is the pre-submission assembly state; it is not in the original
  six-status spec but is required because the spec itself splits Create → Upload
  → Submit into separate use cases, which needs a state that exists before
  submission.
- **Table `professional_verifications`** — the case aggregate. FK to
  `professional_profiles` is **RESTRICT** (a compliance record must not vanish
  if the profile is hard-deleted; profiles are soft-deleted anyway). Reviewer FK
  to `users` is **SET NULL**. Indexes on `professionalProfileId`, `status`,
  `reviewedByUserId`, `(status, submittedAt)`.
- **Table `professional_verification_documents`** — CASCADE with its parent
  case. Reuses the existing `VerificationDocumentType` / `VerificationDocumentStatus`
  enums (no parallel enums introduced). Stores `fileUrl`, `originalFilename`,
  `mimeType`, `fileSizeBytes`.
- **Partial unique index** `professional_verifications_active_unique` on
  `professionalProfileId WHERE status <> 'EXPIRED'` — enforces “at most one
  active case per professional” at the DB level (Prisma can’t express partial
  unique indexes, so it is hand-written in the migration). Backed up by an
  application check in `CreateProfessionalVerificationUseCase`.
- **`NotificationType`** gains `VERIFICATION_SUBMITTED`, `VERIFICATION_APPROVED`,
  `VERIFICATION_REJECTED`, `VERIFICATION_RESUBMISSION_REQUIRED`.

The professional’s **public trust signal** remains the pre-existing
`ProfessionalProfile.verificationStatus` (`UNVERIFIED/PENDING/VERIFIED/REJECTED`)
+ `verifiedAt` — this module writes it on submit/approve/reject so the existing
public badge keeps working with no schema change.

## Lifecycle & Transition Rules (server-enforced)

```
DRAFT                 → PENDING                                   (professional submits)
PENDING               → UNDER_REVIEW | APPROVED | REJECTED | RESUBMISSION_REQUIRED
UNDER_REVIEW          → APPROVED | REJECTED | RESUBMISSION_REQUIRED
RESUBMISSION_REQUIRED → PENDING | UNDER_REVIEW                    (professional resubmits)
REJECTED              → PENDING                                   (professional resubmits)
APPROVED              → EXPIRED
EXPIRED               → (terminal; a fresh case may be opened)
```

Rules live in `professional-verification-rules.ts` and are re-checked in every
use case (never trusting the UI):

- **Who can submit**: only the owning professional with an ACTIVE profile.
- **Who can review**: only ADMIN/SUPER_ADMIN.
- **Required documents before submission**: at least one identity document
  (`NATIONAL_ID`/`PASSPORT`/`DRIVER_LICENSE`).
- **Document mutation**: only while `DRAFT` or `RESUBMISSION_REQUIRED`.
- **One active case**: a professional may hold at most one non-EXPIRED case;
  an already-APPROVED professional cannot open a new one until it expires.
- **Reasons**: rejection and resubmission both require a 10–1000 char reason.
- Approvals set `expiresAt` (default 365 days).

## Document Handling

Uploaded via a Server Action → `UploadVerificationDocumentUseCase` →
`CloudinaryVerificationDocumentUploadService`. MIME allow-list
(JPEG/PNG/WebP/PDF) and a 10MB cap are enforced in the Server Action **and**
re-checked in the Cloudinary service (defense in depth, same as the avatar/
request-photo services). Uploads use `resource_type: "auto"` (for PDFs) and
`type: "private"`. Removal hard-deletes the row (only allowed in a
document-modifiable state); documents also CASCADE with their case.

## Security / Authorization Model

- Every sensitive Server Action authorizes server-side: professional actions via
  `requireAuth()` + ownership re-derived from the session inside the use case
  (`professionalProfileId`/`verificationId` are never accepted from the client
  for the owner’s own case); admin actions via
  `requireRole(ROLES.ADMIN, ROLES.SUPER_ADMIN)`.
- Cross-professional access is denied: `RemoveVerificationDocumentUseCase`
  verifies the document’s parent case belongs to the caller’s own profile
  (returns `NotFoundError` otherwise). CUSTOMER/other PROVIDER/unauthenticated
  callers are rejected identically.
- Document `fileUrl`s are **never** exposed on any public response. The public
  professional profile (`PrismaProfessionalDiscoveryRepository` /
  `GetProfessionalPublicProfileUseCase`) exposes only the safe
  `verificationStatus` enum — no reasons, reviewer ids, document URLs, or
  internal notes. Admin list rows (`AdminVerificationListItem`) carry no file
  references at all; only the ADMIN-guarded detail view returns document URLs.
- The `/admin/verifications` tree is protected by `(dashboard)/admin/layout.tsx`
  (role redirect) **and** middleware’s existing `/admin` role gate, in addition
  to each action’s own `requireRole()`.

## Admin Workflow

`/admin/verifications` — paginated queue with a status filter and professional
identification (business name / name / email), status, submitted/reviewed
dates. `/admin/verifications/[id]` — full detail: professional info, documents
(secure “Open” links), and review actions: **Start review**, **Approve**,
**Reject** (reason required), **Request resubmission** (reason required). Reason
requirements are enforced server-side in both the Zod schema and the use case.

## Professional Workflow

`/dashboard/professional/verification` — shows the current status with
human-readable copy for each state, the uploaded documents, upload/remove
controls (only when editable), and a Submit/Resubmit button. Rejection reasons
and resubmission instructions are shown; reviewer identity and other internal
data are never shown.

## Audit Logging

Reuses the Module 16 append-only `AuditLog` via `AdminAuditLogRepository`
(no new audit system). New `AdminAuditAction` values map to the existing
`VERIFICATION` `AuditLogAction`; the concrete action name is preserved in
`metadata.adminAction`. Logged events: `VERIFICATION_DOCUMENT_UPLOADED`,
`VERIFICATION_DOCUMENT_REMOVED`, `VERIFICATION_SUBMITTED`,
`VERIFICATION_RESUBMITTED`, `VERIFICATION_REVIEW_STARTED`,
`VERIFICATION_APPROVED`, `VERIFICATION_REJECTED`,
`VERIFICATION_RESUBMISSION_REQUESTED`. Metadata is safe only — document URLs,
bytes and reason prose are never written to the audit log (reasons live on the
case row).

## Notifications

Reuses the Module 15 `NotificationCreator` port + `NotificationServiceCreator`
(best-effort, wrapped in try/catch so a notification failure never rolls back
the primary operation). Recipient is always the owning professional’s user,
resolved server-side. Events: submitted/resubmitted (`VERIFICATION_SUBMITTED`),
approved (`VERIFICATION_APPROVED`), rejected (`VERIFICATION_REJECTED`),
resubmission requested (`VERIFICATION_RESUBMISSION_REQUIRED`).

## API / Server Action Boundaries

- Professional: `requestVerification`, `uploadVerificationDocument`,
  `removeVerificationDocument`, `submitVerification`, `resubmitVerification`
  (`src/app/(dashboard)/dashboard/professional/verification/actions.ts`).
- Admin: `startVerificationReview`, `approveVerification`, `rejectVerification`,
  `requestVerificationResubmission`
  (`src/app/(dashboard)/admin/verifications/actions.ts`).

There is no public/unauthenticated write path, and no path that reads a
role/actor id from client input.

## Tests

- Unit: `tests/unit/core/domain/professional-verification-rules.test.ts`
  (transitions, state predicates, required-document rule, reason validation,
  expiry) and `tests/unit/core/application/dto/verification.dto.test.ts` (DTO
  validation incl. required reasons).
- Integration: `tests/integration/verification/verification-flows.test.ts` with
  `fakes.ts` — full professional flow, cross-professional document-access
  denial, non-professional/suspended denial, admin list/filter/detail,
  start-review → approve (verifies profile + audit + notification),
  reject with & without reason, request-resubmission (+ resubmit),
  audit-log creation, notification creation, duplicate-active-case prevention,
  already-approved edge case, and the “no sensitive data in audit metadata”
  property.

## Validation (real results in this environment)

This module was implemented in a Linux sandbox whose pre-installed
`node_modules` is **macOS/darwin-arm64-native** and whose network is
allow-listed (npm registry + Prisma engine CDN return 403). Consequently the
platform-native toolchain (Prisma engines, rollup/esbuild for vitest, Next’s
SWC) cannot execute in-place here. Results, honestly:

- **Types — PASS.** `tsc` is pure-JS and runs. The Prisma client was generated
  to a temporary out-of-tree location (`prisma/.generated-client`, gitignored)
  using a local engine mirror, and `tsc --noEmit` against it returned **exit 0**
  across all new and edited files (including tests). The default
  `npm run typecheck` currently fails only with `Property 'professionalVerification'
  does not exist on PrismaClient` / `NotificationTypeValue not assignable` — i.e.
  solely because the in-place `@prisma/client` could not be regenerated in the
  sandbox (the mounted `node_modules` disallows the unlink the generator needs).
  These disappear after a normal `prisma generate` on a dev machine.
- **Lint — PASS.** `eslint .` (excluding the temporary `prisma/.generated-client`
  artifact) returns **exit 0**. Targeted lint of every new/edited file: exit 0.
- **Unit + integration tests — PASS (32/32).** `npm test` (vitest) cannot start
  here because `@rollup/rollup-linux-arm64-gnu` isn’t installed (the darwin
  build is). The pure-TS test subset was instead compiled with `tsc` and run
  under a minimal CommonJS harness: **32 passed, 0 failed**. On a dev machine
  `npm test` runs them normally (they use fake repositories, no DB).
- **`prisma validate` / `prisma generate` (in-place) — BLOCKED by environment.**
  The engine download returns 403 and the mounted `node_modules` disallows the
  in-place rewrite. The schema was validated indirectly: `prisma generate`
  succeeded against a local engine mirror when pointed at a writable out-of-tree
  output, producing a client with the new models.
- **`next build` — BLOCKED by environment.** Next could not load
  `@next/swc-linux-arm64-*` (only the darwin SWC binary is installed).

**To reproduce/confirm on a normal dev machine:**
`npm run prisma:generate && npm run prisma:migrate && npm run typecheck &&
npm run lint && npm test && npm run build` — and delete the sandbox artifacts
`prisma/.generated-client/` and `tsconfig.typecheck.json` (both gitignored;
the sandbox mount disallowed deleting them here).

## Known Limitations

- Cloudinary assets are uploaded as `type: "private"`; the secure admin/owner
  read path currently links the returned `secure_url` directly. Issuing
  short-lived **signed** delivery URLs for private assets on that read path is a
  recommended hardening follow-up (the important invariant — never exposing the
  URL publicly — already holds).
- No automatic expiry job: `APPROVED → EXPIRED` is modelled (via `expiresAt`)
  but a scheduled transition/cron is left to a future infra module.
- Per-document review status exists on the schema but the admin UI approves/
  rejects at the case level (per-document rejection is a straightforward future
  extension).

## Explicitly Deferred to Modules 18–25

- **Module 18 — Company Professional**: verification for `CompanyProfile` (the
  pre-existing generic `VerificationDocument` model remains for that future use).
- **Module 19 — Search & Ranking**: using verified status as a ranking signal.
- **Module 20 — Maps/Geolocation**.
- **Module 21 — Disputes**.
- **Module 12/Financial — Stripe/commissions/payouts** (untouched).
- **Module 23 — Analytics** (e.g. verification funnel metrics).
- **Module 24 — Security & Anti-Abuse** (e.g. document-fraud detection, rate
  limiting).
- **Production infra** — signed private-asset delivery, expiry cron, background
  jobs.
