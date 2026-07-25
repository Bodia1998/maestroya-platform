# Module 21 — Disputes & Support

Repository: `maestroya-platform-auth` · Branch: `feature/disputes-support`

---

## 1. Purpose and scope

Module 21 gives customers, professionals, and companies a way to raise a
formal dispute over an Order/Job, and a way to raise a general (non-order)
support ticket for account/verification/bug/login/general issues. Admins
triage, assign, investigate (with an internal-note channel invisible to
non-admins), and record a **business-level** resolution outcome.

**Explicitly out of scope** (do not look for these anywhere in this
module):

- Stripe/payments, refunds, commission calculations, payouts, or any
  financial ledger — Module 21 only records *what should happen*
  (`DisputeResolution`), never *executes* it. A future Module 22 is
  expected to read a `RESOLVED` dispute's `resolution`/`resolutionNote`
  and perform the actual settlement.
- Evidence virus scanning / malware detection — not implemented; evidence
  files are trusted the same way every other attachment in this codebase
  (MessageAttachment, PortfolioItem, VerificationDocument) already is.
- Real-time chat over WebSockets for the dispute thread — it is a
  request/response Server Action + revalidated page, same as the rest of
  this codebase's non-chat surfaces.
- SLA automation / auto-escalation / auto-close after N days — every
  transition is admin-initiated.
- Reopening a `CLOSED` dispute or ticket.
- Company-owned Job professional-side dispute creation (see Section 5,
  "Known limitation").

## 2. Architecture

Follows the existing layering exactly:

- **Domain**: `src/core/domain/services/dispute-state.ts`,
  `dispute-rules.ts`, `support-ticket-state.ts` (pure, dependency-free);
  `src/core/domain/repositories/dispute-repository.ts`,
  `dispute-message-repository.ts`, `dispute-evidence-repository.ts`,
  `support-ticket-repository.ts` (interfaces only).
- **Application**: `src/core/application/use-cases/dispute/*`,
  `src/core/application/use-cases/support-ticket/*` (one class per
  operation, `compose.ts` per module wiring the Prisma implementations +
  notification/audit-log infrastructure); `src/core/application/dto/
  dispute.dto.ts`, `support-ticket.dto.ts` (zod schemas).
- **Infrastructure**: `src/core/infrastructure/database/prisma/
  repositories/prisma-dispute-repository.ts`,
  `prisma-dispute-message-repository.ts`,
  `prisma-dispute-evidence-repository.ts`,
  `prisma-support-ticket-repository.ts`.
- **Delivery**: `src/app/(dashboard)/disputes/*`,
  `src/app/(dashboard)/support-tickets/*` (customer/professional-facing),
  `src/app/(dashboard)/admin/disputes/*`,
  `src/app/(dashboard)/admin/support-tickets/*` (admin). Minimal,
  functional Next.js Server Components + Server Actions — the priority for
  this module was correct domain/application/infrastructure layers and
  tests, not UI polish.

## 3. Domain model

### Dispute (`disputes` table)

Anchored to **Job** (`jobId`, required) — see "Job vs ServiceRequest
anchoring" below. Fields: `id`, `caseNumber` (unique, human-readable, e.g.
`DSP-2026-000123`), `title`, `jobId`, `serviceRequestId` (denormalized
convenience copy of `job.serviceRequestId`), `raisedByUserId`,
`respondentProfessionalProfileId`/`respondentCompanyProfileId` (exactly one
set, mirroring Quote/Payout's own duality), `reason`, `status`, `priority`,
`description`, `assignedAdminUserId`, `resolution`, `resolutionNote`,
`resolvedAt`/`resolvedByUserId`, `closedAt`/`closedByUserId`,
`createdAt`/`updatedAt`. `quoteId`/`appointmentId` are deliberately **not**
duplicated onto Dispute — both are reachable via `job.quoteId`/
`job.appointments`, per the spec's "do not duplicate order data" guidance.

### Job vs ServiceRequest anchoring

The Module 01 scaffold anchored `Dispute` to `ServiceRequest`. This module
adds `jobId` and makes it the primary anchor: what a customer/professional
actually disputes is the concrete Job engagement (its status, its
completion/cancellation timestamps, its participants), and Job is also
where a future Module 22 will look up amounts to settle. `serviceRequestId`
is kept alongside purely as an admin query-convenience denormalization —
it is always copied from `job.serviceRequestId` at creation time and never
independently writable, so it can never diverge. Tradeoff: a second column
that's redundant with `job.serviceRequestId`, in exchange for not needing a
join through Job for every admin filter/search that wants to show the
originating service request.

### DisputeEvidence (`dispute_evidence` table)

`fileUrl` + `fileName`/`fileType`/`fileSizeBytes` (mirroring
`MessageAttachment`'s metadata fields) + `description`. Reuses the existing
storage abstraction end to end — this module never uploads a file itself,
only persists the URL + metadata of a file already uploaded elsewhere. See
Section 9 for the evidence-access-control limitation this implies.

### DisputeMessage (`dispute_messages` table) — Chat integration decision

**Decision: a dedicated model, not a reuse of `Conversation`/`Message`.**
A dispute thread needs 3-way visibility (customer, professional/company,
admin) plus an admin-only "internal note" channel that must **never** be
reachable by a non-admin code path. Chat's `Conversation`/
`ConversationMember`/`Message` model is built around 1:1/booking
conversations with a different membership and visibility model; bolting a
"some rows are secret from some members" concept onto it would risk
weakening Chat's own existing invariants for every other module that
depends on them. `DisputeMessage` is a small, purpose-built table:
`id`, `disputeId`, `authorUserId`, `body`, `isInternalNote` (boolean,
default `false`), `createdAt`.

The `isInternalNote` boolean — not a separate table — distinguishes the two
kinds of row. The invariant "an internal note is never visible to a
non-admin" is enforced at three independent layers so a single mistake
can't leak one:

1. `DisputeMessageRepository.listPublic` filters `isInternalNote: false`
   **at the query level** (see `PrismaDisputeMessageRepository.listPublic`)
   — never an application-level filter applied after the fact.
2. `GetDisputeByIdUseCase` (the only read path a customer/professional/
   company use case ever calls) only ever calls `listPublic`, never
   `listAll`.
3. `AddDisputeInternalNoteUseCase` is the *only* code path that ever writes
   `isInternalNote: true`, and it takes no client input that could flip
   that flag — it's a hardcoded `true` in the use case body.

### SupportTicket (`support_tickets` table) — Support Tickets vs Disputes

**Decision: a separate, lightweight model, not a unified Case/Ticket
model.** `Dispute` is inherently order-anchored (`jobId`, respondent,
resolution outcome); a general support issue (account problem, bug,
login trouble, a general question) has none of that — no job, no
"other side", no financial-outcome vocabulary. Modeling both as one table
would mean most of Dispute's columns are always null for a ticket, or vice
versa. `SupportTicket` shares Dispute's lifecycle *shape* (open → in
progress/under review → waiting → resolved → closed), its admin workflow
conventions, its notification/audit-log conventions, and its case-number
formatting scheme — but lives in its own table with its own state machine
(`support-ticket-state.ts`), reusing `DisputePriority` as a shared enum
for triage priority since that concept genuinely is identical between the
two.

Fields: `id`, `ticketNumber` (unique, e.g. `TCK-2026-000123`), `category`
(`ACCOUNT`/`VERIFICATION`/`BUG`/`LOGIN`/`GENERAL`/`OTHER`), `subject`,
`description`, `status`, `priority`, `openedByUserId`,
`assignedAdminUserId`, `resolutionNote`, `resolvedAt`/`resolvedByUserId`,
`closedAt`/`closedByUserId`, `createdAt`/`updatedAt`. No thread/messages
model for SupportTicket in this pass — a ticket is a single description +
an eventual resolution note; adding a `DisputeMessage`-equivalent thread
for tickets is a reasonable follow-up but was judged unnecessary for MVP
(documented limitation).

## 4. Enum reconciliation (Module 01 scaffold → this module)

The three enums scaffolded by Module 01 (Database Foundation) had never
been referenced by application code before this module, so they were
**renamed in place** rather than kept side-by-side with new values — see
each enum's own doc comment in `schema.prisma` for the exact mapping.

**`DisputeReason`**: `QUALITY_ISSUE` → `SERVICE_QUALITY`, `DAMAGE_CLAIM` →
`PROPERTY_DAMAGE`, `BILLING_ISSUE` → `PRICE_DISAGREEMENT`,
`BEHAVIOR_ISSUE` → `COMMUNICATION_ISSUE`; `SERVICE_NOT_COMPLETED`/`OTHER`
unchanged; `PROFESSIONAL_NO_SHOW`/`CUSTOMER_NO_SHOW`/`SCOPE_OF_WORK` added.
Final: `SERVICE_NOT_COMPLETED`, `SERVICE_QUALITY`, `PROPERTY_DAMAGE`,
`PROFESSIONAL_NO_SHOW`, `CUSTOMER_NO_SHOW`, `PRICE_DISAGREEMENT`,
`SCOPE_OF_WORK`, `COMMUNICATION_ISSUE`, `OTHER`.

**`DisputeStatus`**: `AWAITING_RESPONSE` split into
`WAITING_FOR_CUSTOMER`/`WAITING_FOR_PROFESSIONAL`; `REJECTED` added;
`ESCALATED` **removed as a status** — "escalated outside the platform" is
now expressed as `DisputeResolution.ESCALATED_EXTERNALLY` on a
`RESOLVED`/`CLOSED` case (it's an outcome, not an in-progress state).
Final: `OPEN`, `UNDER_REVIEW`, `WAITING_FOR_CUSTOMER`,
`WAITING_FOR_PROFESSIONAL`, `RESOLVED`, `REJECTED`, `CLOSED`.

**`DisputeResolution`**: renamed from payment-action vocabulary to
business-outcome vocabulary so Module 22 can consume it without Module 21
ever touching money: `REFUND_CUSTOMER` → `CUSTOMER_FAVOR`,
`PAY_PROFESSIONAL` → `PROFESSIONAL_FAVOR`, `PARTIAL_REFUND` →
`PARTIAL_RESOLUTION`; `FINANCIAL_ADJUSTMENT_REQUIRED` added (a generic
"Module 22 must act" flag distinct from customer/professional-favor);
`NO_ACTION`/`ESCALATED_EXTERNALLY` unchanged. Final: `NO_ACTION`,
`CUSTOMER_FAVOR`, `PROFESSIONAL_FAVOR`, `PARTIAL_RESOLUTION`,
`FINANCIAL_ADJUSTMENT_REQUIRED`, `ESCALATED_EXTERNALLY`.

Since the `disputes` table has never had a row written to it by any prior
module, this migration performs these as a genuine rename/rebuild (see
`prisma/migrations/20260802000000_add_disputes_support_module/
migration.sql`'s own top comment) rather than a backfill migration — safe
today, but documented as an assumption that would need revisiting if this
migration were ever applied to an environment where that no longer holds.

## 5. Lifecycle and transition rules

### Dispute (`dispute-state.ts`)

```
OPEN -> UNDER_REVIEW
OPEN -> REJECTED
UNDER_REVIEW -> WAITING_FOR_CUSTOMER
UNDER_REVIEW -> WAITING_FOR_PROFESSIONAL
UNDER_REVIEW -> RESOLVED
UNDER_REVIEW -> REJECTED
WAITING_FOR_CUSTOMER -> UNDER_REVIEW       (customer responded)
WAITING_FOR_PROFESSIONAL -> UNDER_REVIEW   (professional responded)
WAITING_FOR_CUSTOMER -> RESOLVED
WAITING_FOR_PROFESSIONAL -> RESOLVED
WAITING_FOR_CUSTOMER -> REJECTED
WAITING_FOR_PROFESSIONAL -> REJECTED
RESOLVED -> CLOSED
REJECTED -> CLOSED
```

`CLOSED` is the sole terminal status. `RESOLVED`/`REJECTED` are
deliberately **not** terminal — both must be explicitly moved to `CLOSED`
(admin-only, `CloseDisputeUseCase`) rather than auto-closing, so "the
outcome was decided" stays distinct from "the case is fully archived" (a
future Module 22 might still need to read a `RESOLVED`-but-not-yet-`CLOSED`
dispute's resolution).

An admin may resolve/reject a case directly from `OPEN`, without visiting
`UNDER_REVIEW` first — a Dispute's "review" step is a process marker, not a
hard precondition for every outcome. Every transition, admin-initiated or
not, goes through `canTransitionDisputeStatus` — there is no raw field
write and no "admin bypass" function; `ChangeDisputeStatusUseCase` refuses
to even accept `RESOLVED`/`REJECTED`/`CLOSED` (those go through
`ResolveDisputeUseCase`/`RejectDisputeUseCase`/`CloseDisputeUseCase`, which
collect a required `resolutionNote`).

**Auto-transition on response**: if the dispute is `WAITING_FOR_CUSTOMER`/
`WAITING_FOR_PROFESSIONAL` and the party being waited on posts a new public
message (`AddDisputeMessageUseCase`), it auto-transitions back to
`UNDER_REVIEW`. An admin's own message never triggers this.

### SupportTicket (`support-ticket-state.ts`)

```
OPEN -> IN_PROGRESS
OPEN -> RESOLVED
IN_PROGRESS -> WAITING_FOR_USER
IN_PROGRESS -> RESOLVED
WAITING_FOR_USER -> IN_PROGRESS
WAITING_FOR_USER -> RESOLVED
RESOLVED -> CLOSED
```

No `REJECTED` for SupportTicket — a ticket isn't "upheld or declined", it's
worked until resolved or closed.

## 6. Domain rules (MVP decisions — no prior product spec existed for these)

- **Who can open a dispute**: the customer or the professional party to the
  Job (`resolveJobActor`). Company-owned Job professional-side dispute
  creation is **not yet supported** — `resolveJobActor` (a pre-existing
  primitive this module reuses verbatim) does not resolve company
  ownership; this is a documented, pre-existing limitation of that helper,
  not something this module introduces. A company can still be the
  *respondent* on a dispute a customer opens, and can view/participate via
  `resolveDisputeActor`'s company-membership branch.
- **Which Job states allow opening a dispute**: `IN_PROGRESS`, `COMPLETED`,
  or `CANCELLED` — never `CREATED` (nothing has happened yet to dispute).
  See `dispute-rules.ts`'s `DISPUTABLE_JOB_STATUSES`.
- **Dispute time window**: 30 days after the Job's `completedAt`/
  `cancelledAt` (no window while still `IN_PROGRESS`) — a named, adjustable
  constant (`DISPUTE_WINDOW_DAYS`).
- **One dispute per Job per opener**: both the customer and the
  professional/company may open *independent* disputes on the same Job,
  but the same user may not have a second concurrently-`OPEN` dispute on
  it — enforced in `CreateDisputeUseCase` and backstopped by a partial
  unique DB index (`disputes_open_per_job_per_opener_unique`).
- **Reopening a `CLOSED` dispute/ticket**: not supported. Documented
  limitation.
- **Who resolves/closes**: admin only for both, no auto-close after N days.
- **Admin overrides**: admins may move to any state the whitelist allows,
  always through the same transition-checked use case.

## 7. Authorization model (IDOR prevention)

Every non-admin fact used for authorization is re-derived server-side from
the session + DB relationships — never trusted from client input.

- **`resolveDisputeActor`** (`src/core/application/use-cases/dispute/
  resolve-dispute-actor.ts`): the Dispute-specific analogue of
  `resolveJobActor`, extended with company-membership resolution via
  `CompanyMembershipRepository.findByCompanyAndUser` so a company member
  can access a dispute against their company's Job. A caller with no
  relationship to the Dispute's Job gets the same `NotFoundError` a
  nonexistent dispute id would — never a distinguishable "exists but isn't
  yours" response.
- **Admin access**: admin-facing use cases (`GetAdminDisputeUseCase`,
  `AssignDisputeUseCase`, `ChangeDisputeStatusUseCase`,
  `AddDisputeInternalNoteUseCase`, `ResolveDisputeUseCase`,
  `RejectDisputeUseCase`, `CloseDisputeUseCase`, and their SupportTicket
  equivalents) trust the caller has already been authorized via
  `requireRole(ADMIN, SUPER_ADMIN, SUPPORT)` at the Server Action boundary
  — the same convention every existing admin use case in this codebase
  uses (see `SuspendAdminUserUseCase`).
- **SupportTicket**: simpler — `openedByUserId === userId` (no cross-
  aggregate resolution needed, since a ticket has no Job/counterparty).

## 8. Notifications

Reuses `src/core/infrastructure/notifications/notification-service.ts`
(`NotificationServiceCreator`, implementing the `NotificationCreator` port)
exactly as every other module does — never a new notification mechanism.
13 new `NotificationType` values were added (see `schema.prisma`'s
`NotificationType` doc comment): `DISPUTE_CREATED`, `DISPUTE_ASSIGNED`,
`DISPUTE_STATUS_CHANGED`, `DISPUTE_RESPONSE_REQUESTED`, `DISPUTE_RESOLVED`,
`DISPUTE_REJECTED`, `DISPUTE_CLOSED`, `SUPPORT_TICKET_CREATED`,
`SUPPORT_TICKET_ASSIGNED`, `SUPPORT_TICKET_STATUS_CHANGED`,
`SUPPORT_TICKET_RESOLVED`, `SUPPORT_TICKET_CLOSED`. Every notification
call is wrapped in try/catch and is best-effort — a notification failure
never rolls back or fails the triggering use case (same convention as
`CreateReviewUseCase`).

## 9. Audit logging

Reuses `AdminAuditLogRepository`/`AuditLog` exactly — no parallel audit
mechanism. New `AdminAuditAction` values added to
`admin-audit-log-repository.ts` (`DISPUTE_CREATED`, `DISPUTE_ASSIGNED`,
`DISPUTE_STATUS_CHANGED`, `DISPUTE_MESSAGE_ADDED`,
`DISPUTE_EVIDENCE_ADDED`, `DISPUTE_INTERNAL_NOTE_ADDED`,
`DISPUTE_RESOLVED`, `DISPUTE_REJECTED`, `DISPUTE_CLOSED`, and the
`SUPPORT_TICKET_*` equivalents), mapped to the closest existing
`AuditLogAction` DB enum value (`CREATE`/`UPDATE`/`STATUS_CHANGE`) in
`prisma-admin-audit-log-repository.ts`'s `ADMIN_ACTION_TO_LOG_ACTION`
table, with the concrete action name preserved in `metadata.adminAction` —
same convention every prior module (17, 18) established. Metadata is kept
to references only (message/evidence/note **ids**, status transitions,
resolution enum) — never full message bodies, evidence content, or file
URLs, per the module spec's "do not log sensitive data unnecessarily".

## 10. Evidence handling

`DisputeEvidence.fileUrl` is a plain URL, same as `MessageAttachment.url`/
`PortfolioItem.mediaUrl` — this codebase's storage abstraction
(`src/core/infrastructure/storage`) has no signed/scoped-access primitive
today. **Known limitation, not solved by this module**: dispute evidence
URLs are not access-controlled at the storage layer; only *linking* to
them (reading `DisputeEvidence` rows through `GetDisputeByIdUseCase`'s
authorization check) is access-controlled. This mirrors every other
attachment model in the codebase rather than inventing new storage
infrastructure this module wasn't scoped to build.

## 11. Relationship with other modules

- **Chat**: not reused for the dispute thread — see Section 3's "Chat
  integration decision" above.
- **Order/Job Lifecycle (Module 11)**: Dispute is anchored to Job; opening
  a dispute never mutates `Job.status` — a disputed Job stays in whatever
  status it was in (`IN_PROGRESS`/`COMPLETED`/`CANCELLED`); Job's own
  state machine (`job-state.ts`) is untouched by this module.
- **Reviews (Module 13)**: independent — a Job can be both reviewed and
  disputed; this module does not read or write `Review`.
- **Admin Panel (Module 16)**: integrates via the existing
  `AdminAuditLogRepository` and the `requireRole(ADMIN, SUPER_ADMIN,
  SUPPORT)` convention; does not extend `AdminRepository` (Dispute/
  SupportTicket have their own dedicated repositories, consistent with
  every other module's own aggregate having its own repository rather than
  being folded into `AdminRepository`'s broad oversight interface).
- **Future Module 22 (financial settlement)**: expected to read
  `Dispute.resolution`/`resolutionNote` off a `RESOLVED` dispute and
  execute the actual refund/payout/commission adjustment. Module 21 never
  calls Stripe, never computes an amount, never writes to `Payment`/
  `Payout`/`Commission`/`Refund`.

## 12. Security and privacy considerations

- IDOR prevention: see Section 7 — every read/write use case re-derives
  ownership from the session + DB, never from a client-supplied id.
- Internal notes: see Section 3's three-layer enforcement.
- Audit trail: append-only, no `updatedAt`/soft-delete on `AuditLog`
  (unchanged from its pre-existing design) — an entry can never be edited
  or hidden after the fact.
- No sensitive content (message bodies, evidence file content/URLs) is
  duplicated into audit-log metadata — only references (ids) and enum
  values.
- Evidence URLs are not access-controlled at the storage layer — documented
  limitation (Section 10), not a claim of full confidentiality.

## 13. Testing strategy

- `tests/unit/core/domain/dispute-state.test.ts` — exhaustive coverage of
  `canTransitionDisputeStatus` and its derived predicates (mirrors
  `job-state.test.ts`'s own structure/exhaustiveness).
- `tests/integration/dispute/fakes.ts` — in-memory test doubles for
  `DisputeRepository`, `DisputeMessageRepository`,
  `DisputeEvidenceRepository`, `SupportTicketRepository`,
  `AdminAuditLogRepository`, implementing the real interfaces (including
  the same unique-constraint/optimistic-concurrency semantics the Prisma
  implementations enforce) so use cases under test run genuine
  orchestration/authorization logic.
- `tests/integration/dispute/dispute-flows.test.ts` — create dispute
  (success, unauthorized/unrelated-job rejection, one-open-per-user-per-job
  conflict, audit log + notification side effects); read authorization
  (raiser, respondent, unrelated user IDOR, admin); valid/invalid status
  transitions including the WAITING_FOR_* auto-transition-on-response
  behavior; assignment; internal notes (stored + admin-visible + verified
  absent from the non-admin read path, at both the use-case and repository
  level); evidence attachment + authorization; resolution/rejection/
  closing (including "cannot resolve a closed case",
  "cannot close before resolving") with notification/audit-log assertions;
  a full support-ticket lifecycle (create → assign → in-progress →
  resolve → close) with IDOR coverage and audit-log assertions.
- Existing module tests are untouched by this module's changes (no shared
  fixture/fake file was modified) — see Section 14 for how this was
  verified given this sandbox's environment limitations.

## 14. Validation results (this environment)

Run in `/sessions/gracious-compassionate-dijkstra/mnt/maestroya-platform-auth`:

- `npm run prisma:generate` — **succeeded** (after working around a
  sandbox-specific `EPERM: operation not permitted, unlink` on
  `node_modules/.prisma/client/*` by moving the stale directory aside
  first — a filesystem quirk of this sandbox's FUSE mount, not a project
  issue). The generated client reflects every new model/enum.
- `npx prisma migrate status` — could not complete: no reachable Postgres
  (`localhost:5432` connection fails) and no Docker binary in this sandbox
  (`docker-compose.yml` exists but `docker`/`docker-compose` are not
  installed here). `npx prisma validate` **did** succeed against the full
  schema.
- `npm test` (and the module-scoped `npx vitest run tests/unit/core/domain/
  dispute-state.test.ts tests/integration/dispute/dispute-flows.test.ts`) —
  could not run: Vitest's Rollup dependency has no `linux-arm64-gnu` native
  binary installed in this sandbox (`node_modules/@rollup/` only contains
  `rollup-darwin-arm64`), and there is no network access to fetch the
  missing package (`npm install` returns `403 Forbidden`). **Confirmed
  environmental, not caused by this module's changes**: running the exact
  same command against an untouched pre-existing test file
  (`tests/integration/review/review-flows.test.ts`) fails with the
  identical `Cannot find module @rollup/rollup-linux-arm64-gnu` error.
- `npm run build` — could not run for the same class of reason: Next.js's
  SWC compiler has no `linux-arm64` native/wasm binary installed and no
  network access to fetch one (`Failed to load SWC binary for linux/arm64`).
- Used instead: `npx tsc --noEmit` (passes with **zero errors** across the
  entire repository, including every new file this module adds) and
  `npx eslint .` (passes with **zero errors/warnings** across the entire
  repository). Both were re-run after every batch of changes in this
  module. Test logic was additionally verified by manual trace-through
  against the exact fake-repository implementations it exercises (see
  Section 13).
