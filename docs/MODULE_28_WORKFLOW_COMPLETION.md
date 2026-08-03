# Module 28 — Workflow Completion

## 1. Purpose and scope

This module closes two long-standing gaps left open by earlier modules:

1. **Expiration**: several enum values (`ServiceRequestStatus.EXPIRED`,
   `QuoteStatus.EXPIRED`, `ProfessionalVerificationStatus.EXPIRED`,
   `VerificationCaseStatus.EXPIRED`) and their backing `expiresAt`/
   `validUntil` columns have existed on the schema since their introducing
   modules (Service Request, Offers/Quotes, Professional Verification,
   Company Professional) but nothing ever transitioned a record into them.
   This module adds the batch use cases, a daily cron entry point, and the
   notification/audit-log wiring that actually enforces those states.
2. **Company disputes**: `resolveJobActor` (Module 11) and
   `CreateDisputeUseCase` (Module 21) only ever resolved the customer or a
   *solo* professional as a Job's actor — a company-owned Job's
   professional side could not open a dispute at all. This module adds a
   company-membership-aware branch, gated by role.

A full audit of every entity's state machine (ServiceRequest, Quote,
Appointment, Job, ProfessionalVerification, CompanyVerification, Dispute,
SupportTicket, Review) was also performed — see section 6.

## 2. Architecture

### 2.1 Expiration

New domain rule modules (`src/core/domain/services/`):

- `service-request-expiration-rules.ts` — `isServiceRequestExpirable(status, expiresAt, now)`. Expirable statuses: `PUBLISHED`, `QUOTED`.
- `quote-expiration-rules.ts` — `isQuoteExpirable(status, validUntil, now)`. Expirable statuses: `PENDING`, `SENT`, `VIEWED`.
- `verification-expiration-rules.ts` — `isVerificationExpirable(status, expiresAt, now)`. Shared between `ProfessionalVerification` and `CompanyVerification` (identical rule: `APPROVED` past `expiresAt`) since both aggregates' `TRANSITIONS` maps already model `APPROVED -> [EXPIRED]` as the sole exit from `APPROVED` (see `professional-verification-rules.ts`/`company-verification-rules.ts`) — this predicate only automates firing an already-modeled transition, it does not invent a new one.

New repository methods (interface + Prisma impl + every in-memory fake):

- `ServiceRequestRepository.findExpirable(now)` — `src/core/domain/repositories/service-request-repository.ts`, `src/core/infrastructure/database/prisma/repositories/prisma-service-request-repository.ts`.
- `QuoteRepository.findExpirable(now)` — same pattern, `quote-repository.ts` / `prisma-quote-repository.ts`.
- `ProfessionalVerificationRepository.findExpirable(now)` — `professional-verification-repository.ts` / `prisma-professional-verification-repository.ts`.
- `CompanyVerificationRepository.findExpirable(now)` — `company-verification-repository.ts` / `prisma-company-verification-repository.ts`.

`ServiceRequestRecord` gained an optional `expiresAt?: Date | null` field (it had none before — every other touched record already had `expiresAt`/`validUntil`). Optional, not required, so every pre-existing object literal across this codebase's tests keeps compiling unchanged; every row read through the real Prisma repository always populates it.

New batch use cases (`src/core/application/use-cases/workflow-expiration/`):

- `ExpireServiceRequestsUseCase` — transitions PUBLISHED/QUOTED → EXPIRED, notifies the customer (`SERVICE_REQUEST_EXPIRED`).
- `ExpireQuotesUseCase` — transitions PENDING/SENT/VIEWED → EXPIRED, notifies the submitting professional (`QUOTE_EXPIRED`).
- `ExpireProfessionalVerificationsUseCase` — transitions APPROVED → EXPIRED, notifies the professional (`VERIFICATION_EXPIRED`). Deliberately does **not** touch `ProfessionalProfile.verificationStatus` (the public trust badge) — see section 5, "Remaining limitations."
- `ExpireCompanyVerificationsUseCase` — same rule for companies, notifies every active company member (`COMPANY_VERIFICATION_EXPIRED`). Also does not touch `CompanyProfile.isVerified`.
- `RunWorkflowExpirationsUseCase` — orchestrator; runs all four batches against one shared `now`, isolates each batch's failure from the others, records one `WORKFLOW_EXPIRATION_RUN` summary audit-log entry.

Each use case follows this codebase's existing conventions exactly: constructor-injected repositories, `notifications: NotificationCreator = new NullNotificationCreator()` default param, try/catch around every notification/audit-log side effect (never fails the primary state transition), and a defensive per-row re-check of the domain predicate even though the repository query already filtered by the same rule.

`compose.ts` module-instantiates concrete Prisma repositories as singletons and exports `makeExpireServiceRequestsUseCase()` / `makeExpireQuotesUseCase()` / `makeExpireProfessionalVerificationsUseCase()` / `makeExpireCompanyVerificationsUseCase()` / `makeRunWorkflowExpirationsUseCase()`, mirroring `dispute/compose.ts`.

### 2.2 Cron entry point

`src/app/api/cron/expire-workflows/route.ts` — a single Next.js Route Handler, `GET` only (Vercel Cron always issues GET). Authorization: shared-secret bearer token — `Authorization: Bearer $CRON_SECRET`, the standard Vercel Cron pattern. `CRON_SECRET` (`src/core/infrastructure/config/env.ts`) is optional at the env-schema level (so environments that never configure cron aren't forced to set it), but the route itself refuses every request with `503` when it's unset — it never silently skips the check. A wrong/missing secret both return the same generic response.

`vercel.json` (new file, none existed before) configures the schedule:

```json
{
  "crons": [{ "path": "/api/cron/expire-workflows", "schedule": "0 3 * * *" }]
}
```

Daily at 03:00 UTC — a low-traffic hour for a Spain-focused marketplace.

### 2.3 Notifications

Four new `NotificationType` values, added via migration
`prisma/migrations/20260808000000_add_workflow_expiration_notifications/`:
`SERVICE_REQUEST_EXPIRED`, `QUOTE_EXPIRED`, `VERIFICATION_EXPIRED`,
`COMPANY_VERIFICATION_EXPIRED`.

Naming deliberately mirrors the existing `VERIFICATION_*` /
`COMPANY_VERIFICATION_*` split from Modules 17/18 (e.g.
`VERIFICATION_APPROVED` vs. `COMPANY_VERIFICATION_APPROVED`) rather than a
single combined `PROFESSIONAL_VERIFICATION_EXPIRED` value, to stay
consistent with every other verification-lifecycle notification already on
the enum.

`AdminAuditAction` gained five values: `SERVICE_REQUEST_EXPIRED`,
`QUOTE_EXPIRED`, `VERIFICATION_EXPIRED`, `COMPANY_VERIFICATION_EXPIRED`,
`WORKFLOW_EXPIRATION_RUN`. `RecordAdminAuditLogData.adminUserId` was widened
from `string` to `string | null` — this is the first *system-triggered*
audit entry in the codebase with no human actor at all; the underlying
`AuditLog.actorUserId` column was already nullable (`onDelete: SetNull`), so
this is a pure type-level relaxation, not a schema change.

### 2.4 Company disputes

`resolveJobActor` (`src/core/application/use-cases/job/resolve-job-actor.ts`)
gained:

- `JobActorRole` widened from `"customer" | "professional"` to
  `"customer" | "professional" | "company"`.
- `JobActor.companyMemberId?: string` — only set for the company role.
- A new optional `deps.companyMembers?: CompanyMembershipRepository`
  parameter. **Every pre-existing caller does not pass it**, so the new
  company branch is structurally unreachable for them — customer/
  professional resolution behavior is byte-for-byte unchanged for every
  existing use case (`cancel-job`, `start-job`, `complete-job`, `get-job`,
  `create-review`, `get-review-by-job`, the two financial use cases). Only
  `CreateDisputeUseCase` now passes `companyMembers`.
- The company branch requires `canActOnBehalfOfCompanyJob(role)` (new
  predicate in `company-membership-rules.ts`) — `true` for
  `OWNER`/`ADMIN`/`MANAGER`, `false` for `MEMBER`. A `MEMBER` of the right
  company, or a removed former member, gets the same `NotFoundError` an
  unrelated user would.

`CreateDisputeUseCase` now passes `companyMembers` into `resolveJobActor`
and its `resolveRespondentUserIds` helper was fixed to actually resolve the
customer's `User.id` via `CustomerProfileRepository.findById` when the
raiser is a professional or company (previously a documented no-op, because
that path was unreachable before this module — the method existed all
along, it was simply never called from there).

Note: this codebase already had a **separate**, read-oriented
`resolveDisputeActor` (Module 21, `dispute/resolve-dispute-actor.ts`) that
resolves a "company" role for an *existing* Dispute's messages/evidence,
with no role gate (any active member may read/participate). That function
is unrelated to this change and was not modified — this module only adds
company resolution to the *authoring* path (`resolveJobActor` /
`CreateDisputeUseCase`), which previously had none.

## 3. What was completed

- ServiceRequest expiration (PUBLISHED/QUOTED → EXPIRED).
- Quote expiration (PENDING/SENT/VIEWED → EXPIRED).
- ProfessionalVerification expiration (APPROVED → EXPIRED).
- CompanyVerification expiration (APPROVED → EXPIRED).
- Shared orchestrator + one cron API route + `vercel.json` schedule.
- Company disputes: OWNER/ADMIN/MANAGER company members can now open a
  dispute for a Job their company performed.
- Unit tests for all four new domain-rule predicates plus
  `canActOnBehalfOfCompanyJob`.
- Integration tests for all four expiration use cases, the orchestrator,
  and the company-dispute authorization path (privileged roles succeed,
  MEMBER/removed-member/unrelated-user all still get `NotFoundError`).

## 4. Remaining limitations (explicitly descoped)

- **Appointment has no `EXPIRED` status** (`AppointmentStatus` enum:
  `PENDING_SCHEDULE`, `SCHEDULED` (deprecated/unused), `PROPOSED`,
  `CONFIRMED`, `IN_PROGRESS`, `COMPLETED`, `CANCELLED`, `NO_SHOW`,
  `RESCHEDULED`). Adding one would be a schema change requiring product
  approval, not a "trivially missing transition" — descoped. An
  Appointment that sits in `PROPOSED` forever today has no automatic
  cleanup; it can still be manually cancelled.
- **Job has no `EXPIRED` status** (`JobStatus`: `CREATED`, `IN_PROGRESS`,
  `COMPLETED`, `CANCELLED`) — same reasoning, same descope. A `CREATED`
  Job that never starts has no automatic timeout; only the ServiceRequest
  it's descended from can expire (before a Job exists, a request is still
  `PUBLISHED`/`QUOTED` — once a Quote is accepted the request moves to
  `ACCEPTED` and is no longer expirable by this module's own rule, see
  `service-request-expiration-rules.ts`'s doc comment on scope).
- **Expiring a verification does not revert the public trust badge.**
  `ExpireProfessionalVerificationsUseCase`/`ExpireCompanyVerificationsUseCase`
  transition the *case* (`ProfessionalVerification`/`CompanyVerification`)
  to `EXPIRED` but do not write `ProfessionalProfile.verificationStatus`/
  `CompanyProfile.isVerified` back to unverified. This is a deliberate
  product-scope decision (same boundary `ApproveProfessionalVerification
  UseCase` already respects — only the approve/reject use cases touch that
  field) rather than an oversight; flipping the public badge automatically
  on expiry is a follow-up decision for whoever owns that UX, not assumed
  here.
- **No pagination on `findExpirable`.** All four repository methods load
  every expirable row into memory in one query. Acceptable at expected
  volume for a daily cron on this codebase's current scale; a future
  high-volume deployment can add pagination without changing any caller's
  contract.
- **`resolveDisputeActor`'s existing "company" read-path has no role
  gate** (any active member may read an existing dispute), while the new
  `resolveJobActor` company *authoring* path does gate by role. This is
  intentional, not an inconsistency to fix: reading/participating in an
  already-open dispute is a lower-stakes action than opening a new one on
  the company's behalf.

## 5. Future integration points

- **Stripe / payments (Module 12/22 territory)**: an expired
  `ServiceRequest`/`Quote` never had money move against it (no Payment
  row is created until a Job exists and is completed — see Module 22's
  commission flow), so expiration cannot orphan a charge. The one edge
  worth flagging for a future payments module: if a `Quote` expires
  *after* a customer's payment intent was already created client-side but
  before it was captured, that capture would need to be explicitly
  cancelled — no such flow exists yet since Stripe capture wiring is
  itself out of scope for this repository today (see Module 22's own
  "Future integration points").
- **Tax / IVA (referenced as "Module 26" in Module 25's doc, but no
  `MODULE_26_*.md` exists in this repo)**: expiration has no tax
  implications by itself (nothing taxable happened), but a future
  IVA-aware invoicing module should be aware that an `EXPIRED` Quote must
  never be invoiced — `isQuoteExpirable`'s exclusion of `ACCEPTED` from the
  expirable set already guarantees an accepted (and therefore potentially
  invoiced) quote can never retroactively expire out from under an
  invoice.

## 6. Workflow audit (state-machine reachability + exit transitions)

| Entity | States | Every state reachable? | Every non-terminal state has an exit? |
|---|---|---|---|
| ServiceRequest | DRAFT, PUBLISHED, QUOTED, ACCEPTED, IN_PROGRESS, COMPLETED, CANCELLED, EXPIRED, DISPUTED | DRAFT/IN_PROGRESS/DISPUTED are schema-reserved, not yet written by any use case (documented since Module 01/09 — see `service-request-state.ts`). PUBLISHED/ACCEPTED/CANCELLED/EXPIRED (new) are all reachable. QUOTED is schema-reserved too (a request currently stays PUBLISHED even once quoted — see `service-request-repository.ts`'s own doc comment) but is now included in `isServiceRequestExpirable`'s status list for forward-compatibility once a future module starts writing it. | PUBLISHED → CANCELLED/ACCEPTED/EXPIRED (new). EXPIRED/CANCELLED are correctly terminal. |
| Quote | PENDING, SENT, VIEWED, ACCEPTED, REJECTED, EXPIRED, WITHDRAWN | PENDING is schema-reserved (quotes are created directly as SENT — see `prisma-quote-repository.ts`'s `create`). SENT/VIEWED/ACCEPTED/REJECTED/WITHDRAWN/EXPIRED (new) all reachable. | SENT/VIEWED → ACCEPTED/REJECTED/WITHDRAWN/EXPIRED (new). All terminal states correctly have no further transition. |
| Appointment | PENDING_SCHEDULE, SCHEDULED (deprecated), PROPOSED, CONFIRMED, IN_PROGRESS, COMPLETED, CANCELLED, NO_SHOW, RESCHEDULED | SCHEDULED confirmed dead (see section 7 below) — every other state is reachable via `appointment-state.ts`'s existing transition map. | No `EXPIRED` exit exists or was added (see section 4) — a stuck `PROPOSED` has no automatic timeout. Flagged as a gap, not fixed (schema change required). |
| Job | CREATED, IN_PROGRESS, COMPLETED, CANCELLED | All reachable via `job-state.ts`. | No `EXPIRED` exit (see section 4) — same reasoning as Appointment. |
| ProfessionalVerification / CompanyVerification | DRAFT, PENDING, UNDER_REVIEW, APPROVED, REJECTED, RESUBMISSION_REQUIRED, EXPIRED | All reachable. | APPROVED → EXPIRED was modeled since Module 17/18 but never fired — **this module closes that gap.** |
| Dispute | OPEN, UNDER_REVIEW, WAITING_FOR_CUSTOMER, WAITING_FOR_PROFESSIONAL, RESOLVED, REJECTED, CLOSED | All reachable per `dispute-state.ts` (unchanged by this module). | Unchanged — out of this module's scope beyond the authorization fix in section 2.4. |
| SupportTicket | OPEN, IN_PROGRESS, WAITING_FOR_USER, RESOLVED, CLOSED | All reachable per `support-ticket-state.ts` (unchanged). | Unchanged — out of scope. |
| Review | PENDING, PUBLISHED, FLAGGED, REMOVED | All reachable per existing Module 13/16 use cases (unchanged). | Unchanged — out of scope. |

## 7. Dead code found while auditing (evidence)

- `AppointmentStatus.SCHEDULED` — the enum's own doc comment already says
  "Deprecated/unused... no code writes it." Confirmed:
  `grep -rn '"SCHEDULED"' src/core` finds no write site; it exists only in
  the Prisma enum for backward compatibility with the initial migration.
  Genuinely dead, not touched by this module (removing an enum value is a
  breaking schema change outside this module's scope).
- No other newly-discovered dead code was found while implementing this
  module's changes — `resolveDisputeActor`'s existing company branch (see
  section 2.4) is *not* dead, it's actively used by `GetDisputeByIdUseCase`
  and message/evidence use cases for existing disputes.

## 8. Testing strategy

- **Unit** (`tests/unit/core/domain/services/`): one file per new domain
  predicate — `service-request-expiration-rules.test.ts`,
  `quote-expiration-rules.test.ts`, `verification-expiration-rules.test.ts`
  — boundary case (`<=` at the exact instant), null-`expiresAt`/
  `validUntil` short-circuit, and every non-expirable status rejected.
  `canActOnBehalfOfCompanyJob` covered in the existing
  `company-membership-rules.test.ts`.
- **Integration** (`tests/integration/workflow-expiration/`): a new
  `fakes.ts` (only `FakeCompanyVerificationRepository` was genuinely new —
  every other repository this module touches already had a fake) plus
  `workflow-expiration-flows.test.ts` covering all four batch use cases and
  the orchestrator (shared `now`, one summary audit-log entry,
  per-batch isolation implied by construction).
- **Integration** (`tests/integration/dispute/company-dispute.test.ts`,
  new file, kept separate from the pre-existing `dispute-flows.test.ts` to
  avoid bloating it): OWNER/ADMIN/MANAGER succeed, MEMBER and a removed
  former OWNER both get `NotFoundError`, and an unrelated user's
  pre-existing `NotFoundError` behavior is explicitly re-verified
  unchanged.

## 9. Validation results (this environment)

This sandboxed tool-execution environment has no outbound network access
and a Linux/arm64 userspace distinct from this project's normal macOS
development machine (whose cached Prisma engine binaries are
`darwin-arm64`, not usable here). Concretely, in this session:

- `npx tsc --noEmit` — **ran successfully** (pure TypeScript, no native
  binary dependency). Found and fixed three real errors caused by this
  module's changes (two page components narrowing `JobActorRole` too
  strictly, one test using a `DisputeReasonValue` that doesn't exist).
  After fixes, exactly **one** error remains:
  `prisma-notification-repository.ts(83,9)`, `NotificationTypeValue` not
  assignable to `NotificationType` — this is expected and not a bug: the
  generated `@prisma/client` in this sandbox is stale (predates this
  module's four new enum values) and could not be regenerated here (see
  below). It will resolve on its own once `npx prisma generate` runs
  wherever the schema migration is actually applied.
- `npx eslint` on every new/changed file — **zero errors, zero warnings**
  after one `import type` fix.
- `npx prisma validate` / `npx prisma generate` — **could not run**:
  `Error: Failed to fetch the engine file at
  https://binaries.prisma.sh/...schema-engine.gz - 403 Forbidden`. No
  outbound network access from this sandbox. Must be run on a machine with
  network access (or from a pre-warmed engine cache) before this branch is
  merged/deployed.
- `npx vitest run` (unit + integration suite) — **could not run**:
  `Cannot find module @rollup/rollup-linux-arm64-gnu` — this sandbox's
  `node_modules` only has the platform-specific optional dependency for
  the project's normal host (npm's well-known optional-dependency
  resolution bug, also referenced in this repo's own prior migration
  comments about environment limits). Requires `npm install` on a machine
  with network access to pull the correct native binary, or the project's
  actual CI/dev environment.
- `npm run build` (`next build`) — not attempted; it would fail for the
  same rollup/webpack native-binary reason as vitest.

**Action required before merge**: on a machine with normal network access
(the project's actual dev/CI environment), run, in order: `npm install`
(if `node_modules` was touched), `npx prisma generate`, `npx prisma
validate`, `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`.
Every static check this environment *could* run (`tsc`, `eslint`) is
already clean.
