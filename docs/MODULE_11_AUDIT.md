# Module 11 — Order / Job Lifecycle
## Repository Audit & Gap Analysis

Repository: `maestroya-platform-auth` · Branch: `feature/order-job-lifecycle`
Audit date: 2026-07-23 · Scope: read-only, no code/schema/migration changes made

---

## 1. Executive Summary

Modules 1–10 built a complete request→quote→appointment pipeline but stopped at "the visit is confirmed." There is no Order or Job model in the schema, and none is needed as a *new top-level entity* for the core happy path — the codebase already treats `ServiceRequest` as the job record (its own docs call it "the core job posting of the marketplace") and reserves `ServiceRequestStatus.IN_PROGRESS` / `COMPLETED` for exactly this purpose, unused since the day the enum was written. `AppointmentStatus.COMPLETED` is similarly fully specified in the domain layer (`appointment-state.ts`) and unit-tested, but has zero repository method, use case, Server Action, or UI wiring anywhere.

So Module 11's job is narrower and more mechanical than "invent Order/Job": wire up the missing `CONFIRMED → COMPLETED` appointment transition, decide how that propagates to `ServiceRequest.status`, add a job-level cancellation path distinct from Module 10's appointment cancellation, and expose all of it through repositories, use cases, Server Actions, and UI — following the exact authorization, concurrency, and chat-notification conventions Module 10 already established.

One schema gap does exist and is real, not cosmetic: nothing in the current model represents "work executed" separately from "a visit occurred." A multi-appointment job (the domain docs explicitly anticipate "multi-day renovation" with several Appointments per Quote) has no place to hold job-level state, a start/completion timestamp independent of any one visit, or a history of who did what. The recommendation in this audit is a new, deliberately thin `Job` model — not `Order` (name collision with a future e-commerce/checkout meaning) and not `WorkOrder` (implies work-order-as-primary-artifact, wrong emphasis for a services marketplace) — that sits between the accepted Quote and its Appointments, is created 1:1 with quote acceptance, and owns exactly the execution-state fields ServiceRequest and Appointment don't.

No Payment, Review, Dispute, Commission, Payout, Notification, or Transaction application code exists anywhere in `src/` — every one of those is a schema-only stub. Module 11 must not implement any of them; it must only leave clean seams (FK-ready fields, a stable status enum, chat events) for Modules 12/13/21/22 to attach to later.

---

## 2. Existing Functionality Relevant to Module 11

What already exists, so Module 11 does not duplicate it:

- **ServiceRequest lifecycle** (`service-request-state.ts`, Module 06): `DRAFT → PUBLISHED → ACCEPTED` is the only implemented path (`PUBLISHED` is the "open" state; edit/cancel/accept all gate on it). `IN_PROGRESS`, `COMPLETED`, `QUOTED`, `EXPIRED`, `DISPUTED` are declared on the Prisma enum but **never produced by any code**.
- **Quote lifecycle** (`quote-state.ts`, Module 08): `PENDING/SENT/VIEWED → WITHDRAWN` is the only generic transition; `ACCEPTED`/`REJECTED` are set exclusively by the dedicated `QuoteAcceptanceRepository.acceptQuote` atomic transaction, not by `canTransitionQuoteStatus`. `EXPIRED` is unimplemented.
- **Quote acceptance → Appointment creation** (`accept-quote.use-case.ts` + `QuoteAcceptanceRepository`, Module 10 MVP slice): one atomic transaction that (1) re-verifies `ServiceRequest.status === PUBLISHED`, (2) `Quote → ACCEPTED` (conditioned on id+status match), (3) every other open Quote on the request → `REJECTED`, (4) `ServiceRequest → ACCEPTED`, (5) creates exactly one `Appointment` (`status: PENDING_SCHEDULE`, no schedule yet). This is already race-safe and already enforces "one accepted quote per request" — confirmed by an integration test asserting a second acceptance attempt is rejected.
- **Appointment scheduling lifecycle** (Module 10, `booking/*.use-case.ts` + `appointment-state.ts` + `PrismaAppointmentRepository`): `PENDING_SCHEDULE → PROPOSED → CONFIRMED`, non-destructive `reschedule` (old row → `RESCHEDULED`, new linked row created), `cancel` (reachable from any non-terminal state). Every mutating repository method uses an `expectedStatuses` optimistic-concurrency guard (`ConflictError` on race loss); `confirm()` additionally re-checks double-booking against other `CONFIRMED` appointments for the same provider inside an interactive `$transaction`.
- **`AppointmentStatus.COMPLETED`**: declared on the enum, fully specified as `CONFIRMED → COMPLETED` in `appointment-state.ts`'s `isCompletableStatus()`/`canTransitionAppointmentStatus()`, and unit-tested in isolation — but **no repository method, use case, Server Action, or UI element ever produces it.** This is the single most concrete, ready-to-wire gap in the whole audit.
- **Chat integration pattern** (`AppointmentNotifier` port + `ChatAppointmentNotifier`, Module 10): booking use cases call `notifier.notify({ type: "PROPOSED"|"CONFIRMED"|"CANCELLED"|"RESCHEDULED", ... })` in a try/catch that never blocks or rolls back the booking write on notification failure. The notifier looks up the existing conversation for the service request and posts a `SYSTEM`-type `Message`; it never creates a conversation and no-ops silently for company-owned appointments (professionalProfileId null). `COMPLETED` is not in `AppointmentEventType` yet.
- **Authorization pattern** (`rbac.ts` + `resolveAppointmentActor`, used identically across Modules 06–10): `requireAuth()` at the Server Action boundary → derive the caller's own `CustomerProfile`/`ProfessionalProfile` from `userId` → verify the resource (`ServiceRequest`/`Quote`/`Appointment`) actually belongs to that profile → `NotFoundError` (never a distinguishable "forbidden") on any mismatch, so ownership can't be probed.
- **Testing conventions**: `tests/integration/booking/{booking-flows,appointment-lifecycle}.test.ts` cover auth boundaries, every state-machine edge, scheduling conflicts, and concurrency races (concurrent confirm, confirm-vs-cancel, concurrent reschedule) against in-memory fakes in `tests/integration/booking/fakes.ts`; `tests/unit/core/domain/*-state.test.ts` cover pure transition predicates.
- **Payment / Review / Dispute / Commission / Payout / Transaction / Notification / VerificationDocument**: Prisma models exist (with FKs to `ServiceRequest`/`Quote`/`Payment` etc.), but zero repositories, use cases, DTOs, or Server Actions reference any of them anywhere in `src/`. They are pure schema scaffolding for future modules.

---

## 3. Architectural Findings

Three findings shape everything else in this audit.

**Finding 1 — ServiceRequest already is the "job."** The domain docs (`docs/DOMAIN_MODEL.md`) describe `ServiceRequest` as "the core job posting of the marketplace," `Review` as reviewing "a completed ServiceRequest," and `Payment` as paying "for a ServiceRequest/Quote." Every future-module FK in the schema (`Payment.serviceRequestId`, `Review.serviceRequestId`, `Dispute.serviceRequestId`) points at `ServiceRequest`, not at `Quote` or `Appointment`. The reserved-but-unused `IN_PROGRESS`/`COMPLETED` values on `ServiceRequestStatus` are the strongest signal: this enum was written expecting exactly the transitions Module 11 needs to implement.

**Finding 2 — Appointment is a "visit," not "the job."** The schema comment on `Appointment` is explicit: "One Quote can produce multiple Appointments (e.g. a multi-day renovation job)." That sentence alone rules out treating Appointment as the unit that tracks overall job progress — a 4-visit renovation has 4 Appointment rows, each independently proposed/confirmed/completed/cancelled, but the *job* is a single thing with its own start, its own completion, and its own cancellation, independent of any single visit's fate.

**Finding 3 — there is a real gap between "one Appointment done" and "the job done" that no existing field can hold.** If `ServiceRequestStatus` alone tracked execution, a multi-appointment job would have nowhere to record which of its 4 visits are done, or a single "work started" timestamp not tied to whichever Appointment happened to be first. `ServiceRequest.status = IN_PROGRESS` can mean "at least one appointment happened" or "all appointments are scheduled" — the field is too coarse to be authoritative once more than one Appointment exists per Quote, and the schema deliberately already supports that case.

**Resolution — introduce a `Job` model, but keep it thin and correctly subordinate.** `Job` is *not* a replacement for `ServiceRequest`, and it does not turn into the thing customers/professionals "browse" — that stays `ServiceRequest`. `Job` is the execution-tracking row created when a Quote is accepted (1:1 with the accepted Quote, at the same moment `QuoteAcceptanceRepository.acceptQuote` already runs), and it is what `Appointment` rows and, eventually, `Payment`/`Review`/`Dispute` rows attach to for "was the work done" semantics, while `ServiceRequest.status` continues to reflect the coarser customer-facing lifecycle (published/accepted/cancelled) it already reflects today. See Section 4 for the full justification and the alternative options considered.

---

## 4. Domain Model Recommendation

**Recommendation: introduce `Job`.**

Three names were evaluated:

| Name | Verdict | Reason |
|---|---|---|
| `Order` | Rejected | Strongly connotes e-commerce checkout/cart semantics this platform doesn't have (no multi-item cart, no order-then-pay-then-ship flow); also risks collision with a future "purchase order" concept if the platform ever adds materials/parts procurement. |
| `WorkOrder` | Rejected | Implies the *work order document* is the primary artifact (construction/manufacturing connotation), which overstates its role here — it's a state tracker, not a dispatched work ticket with its own approval workflow. |
| `Job` | **Recommended** | Matches the module's own name ("Order / Job Lifecycle"), matches how `docs/DOMAIN_MODEL.md` already colloquially refers to ServiceRequest ("job posting") without overloading that term further, and reads naturally in both customer-facing copy ("your job is in progress") and professional-facing copy ("your active jobs"). |

**Why not skip a new model entirely and just extend `ServiceRequest`/`Appointment`?** This was seriously considered, because it's the option that adds the least schema surface. It fails on the multi-appointment case (Finding 3): there is no non-hacky way to represent "3 of 4 visits done, job still in progress" without either (a) a new model, or (b) computing it ad hoc from an Appointment query every time — which then can't hold its own `startedAt`, its own job-level `cancellationReason`, or a stable FK for Payment/Review/Dispute to eventually point at without ambiguity between "the request" and "the specific accepted engagement." A thin `Job` row costs one extra table and one extra join; the alternative costs a permanent modeling seam that Modules 12/13/21/22 all inherit.

**What `Job` deliberately does *not* do:**
- It does not replace `ServiceRequest` as the browsable/searchable job-posting entity — that stays exactly as-is.
- It does not duplicate scheduling — `scheduledStart`/`scheduledEnd`/proposal/confirmation stay on `Appointment`, owned entirely by Module 10's existing code.
- It does not hold money — no amount, currency, or payment-status field; `Payment`/`Commission` continue to exist as Module 12's territory, just gaining a `jobId` FK when that module is built.
- It is not created by the customer or professional directly — it is a system-created side effect of quote acceptance, same as `Appointment` is today.

---

## 5. Relationships

```
CustomerProfile ──┐
                   ├──< ServiceRequest >── Quote >── (accepted Quote) ──1:1── Job
ProfessionalProfile/CompanyProfile ──┘         │                              │
                                                │                              ├──< Appointment (1..N "visits")
                                                │                              │
                                                └──────────< Conversation      ├── (future) Payment  [Module 12, via jobId]
                                                                               ├── (future) Review   [Module 13, via jobId]
                                                                               └── (future) Dispute  [Module 21, via jobId]
```

Cardinalities and rationale:

- **ServiceRequest → Quote**: one-to-many (unchanged, Module 08). A request can receive many quotes; at most one is ever `ACCEPTED`.
- **Quote → Job**: **one-to-one, nullable on Quote's side.** A `Job` exists if and only if its Quote was accepted; not every Quote produces a Job (most are rejected/withdrawn/expired). Enforced the same way `Appointment.quoteId` is already effectively 1:1-per-accepted-quote today — one accepted Quote, one Job, created in the same transaction as today's Appointment creation.
- **ServiceRequest → Job**: one-to-one in practice (a request has at most one accepted quote, hence at most one Job), but modeled as `Job.serviceRequestId` (not the reverse) for the same "denormalize the frequently-joined FK" reason `Appointment.serviceRequestId` already exists despite being derivable through `Quote` — avoids a join for every job-list query, exactly like Appointment's existing denormalized `serviceRequestId`.
- **Job → Appointment**: **one-to-many.** This is the relationship that doesn't exist today and is the reason Job needs to exist — `Appointment.jobId` (new FK, alongside the existing `Appointment.quoteId`/`serviceRequestId`, which stay for backward compatibility and because Appointment's own conflict-checking queries key off `professionalProfileId`/`companyProfileId` directly, not through Job). One Job (a multi-day renovation) can have many Appointments (visits); a single-visit job has exactly one.
- **Job → Payment / Review / Dispute (future)**: each of these currently has a `serviceRequestId` FK and, for Payment, a nullable `quoteId`. Recommendation for Module 11 (schema-prep only, not implementation): leave those FKs as-is for now — do not add `jobId` to Payment/Review/Dispute in this module, since that's schema work for Modules 12/13/21 to own when they're actually built, with full knowledge of their own requirements. Module 11 should only guarantee `Job.id` is a stable, non-recyclable identifier those future modules can safely add a FK to later without a data migration puzzle.
- **CustomerProfile/ProfessionalProfile/CompanyProfile → Job**: no new direct relation needed — ownership is always derived transitively through `Job.serviceRequestId → ServiceRequest.customerId` and `Job.professionalProfileId`/`companyProfileId` (denormalized from the accepted Quote, exactly as `Appointment` already denormalizes them from Quote today), reusing the existing `resolveAppointmentActor`-style ownership derivation pattern.

---

## 6. State Machine Recommendation

**Recommendation: a minimal 5-state Job machine, deliberately smaller than the conceptual hypothesis in the brief.**

```
CREATED ──> IN_PROGRESS ──> COMPLETED
   │             │
   └───────> CANCELLED <────┘
```

| Status | Meaning | Entry condition |
|---|---|---|
| `CREATED` | Job exists, work has not started; may have 0..N unscheduled/scheduled Appointments. | Created atomically alongside Quote acceptance, same transaction as today's Appointment(`PENDING_SCHEDULE`) creation. |
| `IN_PROGRESS` | Work has started on at least one Appointment. | A professional/company marks an Appointment `CONFIRMED → COMPLETED` **or** explicitly starts work — see the two-option discussion below — while the Job is `CREATED`. |
| `COMPLETED` | All work considered done. | Explicit "mark job completed" action, gated on there being no non-terminal (`PENDING_SCHEDULE`/`PROPOSED`/`CONFIRMED`) Appointments remaining — you cannot complete a job with an unresolved visit still outstanding. |
| `CANCELLED` | Job called off before completion. | Either party cancels while `CREATED` or `IN_PROGRESS`. Distinct from Appointment-level cancellation (Section 9) — cancelling one visit does not cancel the Job unless it's the job's only/last Appointment and the cancelling actor explicitly cancels the Job too. |

**Deliberately excluded from the brief's hypothesis:** a separate `SCHEDULED` job status. Scheduling is Appointment's job (literally — Module 10 owns `PENDING_SCHEDULE`/`PROPOSED`/`CONFIRMED`); a Job-level `SCHEDULED` state would just mirror "does this job have at least one CONFIRMED appointment," which is a derivable read, not a state worth persisting and keeping in sync. Also excluded: `DISPUTED` as a Job status — Module 21 (Disputes) is explicitly out of scope, and a dispute doesn't need to *block* the Job state machine (a completed, disputed job is still `COMPLETED` at the Job level; the dispute is a separate parallel record once Module 21 exists), avoiding tight coupling between two future/current modules.

**Open decision this audit flags rather than resolves — "who/what triggers `IN_PROGRESS`":** two designs are viable and the right one depends on a product decision, not a technical constraint:

- **Option A — implicit, derived from Appointment completion.** `IN_PROGRESS` is set automatically the first time any of the Job's Appointments transitions to `COMPLETED` (or, alternatively, to `CONFIRMED` if "in progress" should mean "visit is happening/imminent" rather than "at least one visit is done"). Pro: no new explicit "start job" action/button needed, less surface area. Con: ambiguous semantics for a multi-visit job — is a renovation "in progress" the moment visit 1 is confirmed, or only once visit 1 is actually completed?
- **Option B — explicit "start work" action**, professional-initiated, independent of any specific Appointment's status. Pro: matches the brief's own conceptual lifecycle ("starting work" is called out as in-scope for Module 11 explicitly). Con: one more action, one more authorization check, one more concurrency case (Section 13).

This audit recommends **Option B** (explicit start-work action) because the brief explicitly lists "starting work" as an in-scope Module 11 responsibility distinct from appointment confirmation, and because it gives professionals a clean moment to signal "I am now on-site / working" independent of the visit-scheduling mechanics Module 10 already owns — but this should be confirmed with the product owner before implementation, since Option A is meaningfully less code.

Valid transition table (whichever option is chosen for the `CREATED → IN_PROGRESS` edge):

| From \ To | CREATED | IN_PROGRESS | COMPLETED | CANCELLED |
|---|---|---|---|---|
| CREATED | — | ✅ | ❌ | ✅ |
| IN_PROGRESS | ❌ | — (re-entrant no-op or reject, TBD) | ✅ | ✅ |
| COMPLETED | ❌ | ❌ | ❌ (terminal) | ❌ terminal — see Section 13 for the "reopen a completed job" question |
| CANCELLED | ❌ | ❌ | ❌ | ❌ (terminal) |

---

## 7. Database Gaps

**New model — `Job`:**

```
model Job {
  id                    String     @id @default(uuid()) @db.Uuid
  serviceRequestId      String     @db.Uuid   // denormalized, same pattern as Appointment
  quoteId               String     @unique @db.Uuid  // 1:1 with the accepted Quote
  customerId            String     @db.Uuid   // denormalized from ServiceRequest.customerId
  professionalProfileId String?    @db.Uuid   // denormalized from the accepted Quote
  companyProfileId      String?    @db.Uuid   // exactly one of these two set (CHECK constraint, same pattern as Quote/Appointment)
  status                JobStatus  @default(CREATED)
  startedAt             DateTime?
  startedByUserId       String?    @db.Uuid
  completedAt           DateTime?
  completedByUserId     String?    @db.Uuid
  cancelledAt           DateTime?
  cancelledByUserId     String?    @db.Uuid
  cancellationReason    JobCancellationReason?
  cancellationNote      String?    @db.Text
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  serviceRequest ServiceRequest @relation(fields: [serviceRequestId], references: [id], onDelete: Restrict)
  quote          Quote          @relation(fields: [quoteId], references: [id], onDelete: Restrict)
  appointments   Appointment[]

  @@index([serviceRequestId])
  @@index([customerId])
  @@index([professionalProfileId, status])
  @@index([companyProfileId, status])
  @@index([status])
}

enum JobStatus { CREATED IN_PROGRESS COMPLETED CANCELLED }
enum JobCancellationReason { CUSTOMER_REQUEST PROFESSIONAL_UNABLE_TO_COMPLETE SERVICE_REQUEST_ISSUE OTHER }
```

**Modified model — `Appointment`:** add `jobId String @db.Uuid` (non-nullable — every Appointment created after Module 11 ships belongs to a Job) with an FK (`onDelete: Restrict`, same historical-record rationale as its existing FKs) and index `@@index([jobId])`. Existing `quoteId`/`serviceRequestId` on Appointment stay untouched — this is additive, not a replacement.

**Migration ordering concern:** existing Appointment rows created before Module 11 ships have no Job to point at. Two options: (a) backfill a `Job` row per existing accepted Quote as part of the migration (straightforward — one Job per Quote with `status ACCEPTED` today, derivable in SQL), or (b) make `Appointment.jobId` nullable. Recommendation: (a), backfill — keeps the FK non-nullable and avoids permanent null-handling in every query, and the backfill is a clean, bounded, one-time SQL statement given the existing 1:1 Quote↔(at most one accepted)↔Appointment relationship.

**Indexes:** `Job` needs the same "find my active jobs" indexes Appointment already has (`professionalProfileId, status` / `companyProfileId, status`), since the professional dashboard's primary Module 11 view is almost certainly "my jobs, filtered by status."

**Constraints:** the "exactly one of professionalProfileId/companyProfileId" CHECK constraint must be added via raw SQL in the migration, same as every other instance of this pattern in the schema (Quote, Appointment, Review, Payout, VerificationDocument, Dispute) — Prisma can't express it natively, confirmed by the existing migration comments.

**Audit/history:** no new audit trail table is needed — `AuditLog`'s existing polymorphic `entityType`/`entityId` pattern already covers `Job` for free once Module 11's use cases start writing entries with `entityType: "Job"`, the same way presumably other modules do (worth confirming no module currently writes to AuditLog at all — if none do yet, Module 11 doesn't need to be the first to start, but should not be blocked from doing so either).

---

## 8. Application Gaps

**Repositories (new):**
- `JobRepository` interface (`core/domain/repositories/job-repository.ts`) — `findById`, `listForCustomer`, `listForProfessional`, `startWork` (conditional update, `expectedStatuses` guard), `complete` (conditional update, guard on Job status *and* on no non-terminal Appointments remaining — likely requires an interactive transaction re-reading Appointment state, same style as `PrismaAppointmentRepository.confirm`), `cancel` (conditional update, guard).
- `PrismaJobRepository` implementation, following `PrismaAppointmentRepository`'s optimistic-concurrency + transactional-recheck conventions exactly.

**Repositories (modified):**
- `QuoteAcceptanceRepository.acceptQuote` gains one more write inside its existing transaction: create the `Job` row (`status: CREATED`) alongside the `Appointment` row it already creates, and set the new `Appointment.jobId` to that Job's id.
- `AppointmentRepository` (interface + Prisma impl): every method that creates an Appointment (`acceptQuote`'s side effect, `reschedule`'s new-row creation) must now also propagate `jobId` from the original/superseded Appointment.

**Domain services (new):**
- `job-state.ts`, same style/shape as `appointment-state.ts`: `isStartableStatus`, `isCompletableStatus` (must also check "no non-terminal Appointments" — likely takes an appointment-statuses list as a parameter rather than being a pure Job-status predicate, an intentional deviation from Appointment's pure-predicate style, worth flagging in the actual design doc when this is implemented), `isCancellableStatus`, `canTransitionJobStatus`.

**Use cases (new), under `core/application/use-cases/job/`:**
- `start-job.use-case.ts` — if Option B (Section 6) is chosen.
- `complete-job.use-case.ts` — the highest-value single deliverable in this module; wires the already-fully-specified `Appointment` `COMPLETED` transition together with the new `Job` `COMPLETED` transition. Two sub-decisions: does completing the Job auto-complete any still-`CONFIRMED` Appointments, or does it require the caller to complete every Appointment first? Recommendation: require appointments to be resolved first (simpler, avoids surprising "I completed my job and 2 unrelated appointments silently vanished" behavior) — the Job-completion guard checks for zero non-terminal Appointments rather than force-completing them.
- `complete-appointment.use-case.ts` — the missing piece flagged in Section 2; marks one visit `CONFIRMED → COMPLETED`, following `confirm-appointment.use-case.ts`'s exact shape (`resolveAppointmentActor`, `expectedStatuses` guard, best-effort chat notify). This is Module 10 territory conceptually but the code doesn't exist yet and Module 11 is the natural place to add it since nothing gated it on Module 10 being "done" other than sequencing.
- `cancel-job.use-case.ts` — job-level cancellation, distinct from `cancel-appointment.use-case.ts`.
- `get-job.use-case.ts`, `list-jobs-for-customer.use-case.ts`, `list-jobs-for-professional.use-case.ts` — read-side, mirroring the booking module's equivalents exactly.
- `compose.ts` — DI wiring, same pattern as `booking/compose.ts`.

**DTOs (new):** `job.dto.ts` — request/response Zod schemas for start/complete/cancel actions and list/detail views, following `booking.dto.ts`'s conventions (including its existing timezone-conversion-at-the-boundary pattern if any job action ever takes a client-local timestamp — unlikely here since Job timestamps are all "now," not user-proposed future times).

**Server Actions (new):** `app/(dashboard)/jobs/actions.ts` (or co-located under a new `jobs` route group) — `startJobAction`, `completeJobAction`, `cancelJobAction`, plus `completeAppointmentAction` added to the existing `app/(dashboard)/appointments/actions.ts`.

---

## 9. Authorization Model

Following the existing `requireAuth() → derive ownership → verify relationship → NotFoundError` convention exactly, with a `resolveJobActor` helper mirroring `resolveAppointmentActor`:

| Action | Who | Derivation |
|---|---|---|
| View a job | The job's customer, or the job's professional/an active member of the job's company | `requireAuth()` → own `CustomerProfile`/`ProfessionalProfile`/company membership → `job.customerId`/`job.professionalProfileId`/`job.companyProfileId` must match → else `NotFoundError` |
| Start a job | The professional/company side only (customers don't "start" work) | Same derivation, restricted to the professional side; `NotFoundError` if the caller is the job's customer (not `UnauthorizedError`, consistent with existing convention) or unrelated |
| Mark a job (or one of its appointments) completed | The professional/company side only, in this audit's recommendation — a customer confirming completion is a plausible alternative product decision (two-sided confirmation, common in services marketplaces) but is **not** currently implemented anywhere in this codebase for anything analogous, so this audit does not assume it; flag as a product decision, not a technical default | Professional-side derivation, same pattern |
| Cancel a job | Either party, mirroring `cancel-appointment.use-case.ts`'s "either party can cancel a non-terminal appointment" | Customer-side or professional-side derivation, whichever matches |
| Reopen or dispute a completed job | Out of scope for Module 11 (Dispute = Module 21). No "reopen" action should be implemented now — a completed Job is terminal in this module's own state machine (Section 6); Module 21 will need its own decision about whether a Dispute can force a Job back out of `COMPLETED`, which is explicitly deferred, not decided here | N/A |

---

## 10. Appointment Integration

Module 11 must not duplicate any scheduling logic — `PENDING_SCHEDULE`/`PROPOSED`/`CONFIRMED`, proposal, confirmation, and rescheduling stay 100% owned by Module 10's existing code, untouched. The only two integration points are:

1. **Creation-time linkage**: every Appointment, from the moment it's created (both the initial one from `QuoteAcceptanceRepository.acceptQuote` and any new one from `reschedule`), gets a `jobId` pointing at its Job. This is the one schema/code touch Module 11 makes inside Module 10's existing write paths.
2. **The missing `CONFIRMED → COMPLETED` Appointment transition** (Section 2's central finding) is implemented as part of Module 11, using Module 10's own domain rules (`appointment-state.ts` already has the logic) and Module 10's own conventions (`AppointmentRepository`, `resolveAppointmentActor`, `expectedStatuses` guard, `ChatAppointmentNotifier`). This is filling in Module 10's own unfinished corner, using Module 10's code, not building a competing Module 11-owned completion mechanism for Appointments.

Job-level completion (Section 8) then *reads* Appointment statuses (are there any non-terminal ones left) but never writes them directly except via that one `complete-appointment` use case, keeping a clean one-way dependency: Job depends on Appointment state, Appointment never depends on Job state for its own transitions.

---

## 11. ServiceRequest Integration

**Recommendation: Job status becomes the execution lifecycle; ServiceRequest status stays exactly what it is today (the customer-facing request lifecycle) and gains no new writers.**

Concretely: `ServiceRequest.status` stops at `ACCEPTED` (as it already does today) for the entire duration of the job. It does **not** get pushed to `IN_PROGRESS`/`COMPLETED` by Module 11 — those two enum values remain reserved-but-unused, exactly as they are today, and this audit recommends *not* wiring them up in this module.

Why not use the already-existing `ServiceRequestStatus.IN_PROGRESS`/`COMPLETED` values directly instead of adding a new `Job` model, given they already exist on the enum? Because Finding 3 (Section 3) still applies — one `ServiceRequest` has at most one accepted Quote, so `ServiceRequest.status` genuinely could hold "the job's" state 1:1 *if* a Job had exactly one Appointment always. It can't hold multi-appointment nuance ("3 of 4 visits done") without either becoming a derived/computed field (defeating the point of a stored status) or the request itself acquiring Job's fields directly (which conflates "is this request still accepting quotes" with "has the accepted work been done" — two genuinely different concerns that happen to coincide in the common single-Quote-single-Appointment case but diverge the moment a request is reused, disputed, or partially fulfilled).

**Conflict avoided, not created:** because `ServiceRequest` never writes `IN_PROGRESS`/`COMPLETED`, there is no risk of `ServiceRequest.status` and `Job.status` disagreeing — they simply answer different questions ("can this request still receive/accept quotes" vs. "is the accepted work done"), and only one of the two (`Job`) is authoritative for execution state. A future UI can still display an aggregate "your job is in progress" message to the customer by reading `Job.status`, not by needing `ServiceRequest.status` to say so.

---

## 12. Chat Integration

Job lifecycle events should notify Chat exactly the way Module 10 already does — one-directionally, best-effort, never blocking or rolling back a Job/Appointment write.

Concretely: extend `AppointmentEventType` (currently `"PROPOSED" | "CONFIRMED" | "CANCELLED" | "RESCHEDULED"`) with `"COMPLETED"` for the appointment-level completion event, and introduce a parallel `JobEventType` (`"STARTED" | "COMPLETED" | "CANCELLED"`) on the same `AppointmentNotifier` port (or a sibling `JobNotifier` port reusing the identical shape/implementation pattern — either is fine, the port's shape matters more than whether it's literally the same interface) — reusing `ChatAppointmentNotifier`'s exact lookup-existing-conversation-and-post-a-SYSTEM-message behavior, including its "no conversation exists → silently no-op, never create one" rule and its "company-owned, professionalProfileId null → no-op" rule.

The rule stated in the brief is already this codebase's existing rule and should not be relaxed: **Job/Appointment lifecycle may notify Chat one-directionally; Chat must never own or mutate Job/Appointment state.** No Job or Appointment use case should ever read Conversation/Message state to make a decision — the dependency arrow points exactly one way, exactly as it already does for Module 10.

---

## 13. UI/UX Gaps

**Professional-side (primary actor for most Module 11 actions):**
- A "My Jobs" list (`app/(dashboard)/dashboard/professional/jobs/page.tsx`), filterable by status, mirroring `dashboard/professional/appointments/page.tsx`'s existing list pattern.
- A job detail page (`.../jobs/[id]/page.tsx`) showing the Job's status, its Appointments (reusing `appointment-status-badge.tsx`), and action buttons: "Start work" (if Option B from Section 6), "Mark job completed" (disabled/hidden unless all Appointments are terminal, with an explanatory message if blocked), "Cancel job."
- On the existing appointment detail page (`appointments/[id]/appointment-actions.tsx`), add a "Mark this visit completed" action when `status === "CONFIRMED"`, following the exact button/dialog pattern already used for Cancel.

**Customer-side:**
- A "My Jobs" list and detail view mirroring the professional-side ones (read-mostly; the only customer action per Section 9's recommendation is job cancellation).
- Job progress visible from the existing `requests/[id]/page.tsx` service-request detail view — a small "Job status: In Progress" panel, since the customer's mental model starts at the ServiceRequest they created, not a URL for a "Job" entity they never explicitly navigate to.

**Shared:** a `job-status-badge.tsx` component mirroring `appointment-status-badge.tsx`'s existing style conventions exactly.

---

## 14. Concurrency Risks

Every risk below should be closed the same way Module 10 closes its equivalents — an `expectedStatuses`-conditioned `updateMany`/interactive transaction, never a read-then-write without a re-check:

- **Starting a job twice**: two concurrent "start work" requests (e.g. double-click, or two devices) must not both succeed / both write `startedAt`. Guard: `startWork` conditioned on `status = CREATED`, second caller gets `ConflictError`.
- **Completing a job twice**: same pattern, conditioned on `status IN (CREATED, IN_PROGRESS)`.
- **Cancelling while starting**: a customer cancels the instant the professional starts work. Guard: both `startWork` and `cancel` use the same conditional-update mechanism against the current `status`; whichever transaction commits first wins, the other gets `ConflictError` and the caller is told to refresh — exactly `PrismaAppointmentRepository.confirm`'s existing "lost the race, refresh and retry" contract.
- **Completing while cancelling**: same shape as above, `complete` and `cancel` racing on the same row.
- **Multiple jobs accidentally created for one accepted Quote**: closed by construction, not by a race-detection guard — `Job` creation happens exclusively inside `QuoteAcceptanceRepository.acceptQuote`'s existing transaction, which already has its own race-closing conditional update on `Quote.status`/`ServiceRequest.status` (an integration test already proves a second acceptance attempt is rejected before it ever reaches Appointment/Job creation). As long as Job creation is added *inside* that same transaction (not as a separate follow-up write), this risk doesn't need a new guard — it inherits the existing one for free. This is the single most important implementation detail in Section 15's Phase 1: **do not create Job in a step after `acceptQuote` returns — put it inside the transaction.**
- **Completing a job with a concurrently-proposed new Appointment**: a professional proposes a new visit time (Module 10's `proposeTime`) at the same moment someone else completes the Job. Guard: `complete-job`'s "no non-terminal Appointments" check must happen inside the same transaction as the Job status write (re-read, not trust a pre-fetched list), same interactive-transaction pattern as `PrismaAppointmentRepository.confirm`'s double-booking recheck.

---

## 15. Test Coverage Gaps

Full matrix to build, mirroring `tests/integration/booking/{booking-flows,appointment-lifecycle}.test.ts`'s existing structure and using the same in-memory fake pattern (`tests/integration/booking/fakes.ts`) extended with `FakeJobRepository`:

**Authorization:** each of view/start/complete/cancel job tested for: owning customer succeeds (view/cancel only), owning professional succeeds (all), unrelated user gets `NotFoundError` (not `UnauthorizedError`), unauthenticated request rejected before reaching the use case.

**State transitions (happy path):** `CREATED → IN_PROGRESS → COMPLETED`; `CREATED → CANCELLED`; `IN_PROGRESS → CANCELLED`; the new `Appointment` `CONFIRMED → COMPLETED` transition end-to-end (currently only unit-tested as a pure predicate, per Section 9 of the research findings — needs its first integration-level test).

**Invalid transitions:** complete a `CREATED` job with unresolved appointments (rejected with a clear error, not a silent partial completion); start an already-`IN_PROGRESS`/`COMPLETED`/`CANCELLED` job; cancel a `COMPLETED` job; complete a `CANCELLED` job.

**Concurrency (all six items from Section 14 as explicit tests):** concurrent start-job calls, concurrent complete-job calls, start-vs-cancel race, complete-vs-cancel race, double-acceptance still yields exactly one Job (extending the existing `booking-flows.test.ts` double-acceptance test to assert Job count too, not just Appointment count), complete-job-vs-concurrent-propose-new-appointment race.

**ServiceRequest/Quote/Appointment/Job consistency:** accepting a quote always produces exactly one Job in `CREATED` linked to exactly the Appointment already created; every new Appointment (including rescheduled ones) carries the correct `jobId`; `ServiceRequest.status` never changes as a side effect of any Job transition (an explicit negative assertion, given Section 11's recommendation).

**Customer flows:** view own job, cancel own job, cannot start/complete a job (professional-only per Section 9), cannot view/act on another customer's job.

**Professional flows:** view own job, start own job, complete own job (blocked if appointments outstanding), cancel own job, cannot act on another professional's/company's job.

---

## 16. Future Module Compatibility

- **Module 12 (Payment/Stripe Connect):** `Job.id` becomes the natural anchor for "was the paid-for work actually completed" — Payment capture/release timing will very likely want to key off `Job.status === COMPLETED`, not `Appointment` (a multi-visit job's payment shouldn't release after visit 1). Module 11 should not build any payment-adjacent logic, but `completedAt`/`completedByUserId` on `Job` are exactly the fields Module 12 will need to read.
- **Module 13 (Reviews & Ratings):** reviews should almost certainly gate on `Job.status === COMPLETED` (you can only review a job that's actually done), not `ServiceRequest.status` (which never reaches `COMPLETED` under this audit's recommendation) or `Appointment.status` (too granular — one bad visit review isn't the same as reviewing the whole job). No schema change needed now; `Review.serviceRequestId` stays as-is, Module 13 adds its own `jobId` FK when it's built.
- **Module 21 (Disputes & Support):** a dispute plausibly wants to reference a specific `Job` (or a specific `Appointment` within it) rather than only the whole `ServiceRequest`. Module 11 should keep `Job.id` stable and never reuse/recycle it, so Module 21 can add its own FK later without ambiguity about which engagement is being disputed.
- **Module 22 (Commission & Financial):** `Commission`/`Transaction` will likely also want a `jobId` for reporting ("revenue per completed job"). Same guidance — leave it to Module 22, don't add it speculatively now.

No Module 11 schema field should be named or shaped in a way that guesses at these future FKs' exact form — the safest contribution now is a stable, well-indexed `Job.id` and a small closed `JobStatus` enum other modules can safely read (not write).

---

## 17. MUST IMPLEMENT NOW

- `Job` Prisma model + `JobStatus`/`JobCancellationReason` enums + migration (including the "exactly one of professionalProfileId/companyProfileId" CHECK constraint and the existing-Appointment backfill).
- `Appointment.jobId` FK addition + backfill for pre-existing rows.
- `Job` creation wired into `QuoteAcceptanceRepository.acceptQuote`'s existing transaction (Section 14's "inside the transaction, not after" requirement is non-negotiable for correctness).
- `job-state.ts` domain service (state machine + guards).
- `JobRepository`/`PrismaJobRepository` with the full optimistic-concurrency `expectedStatuses` pattern on every mutating method.
- `complete-appointment.use-case.ts` — closes the single most concrete existing gap (Section 2).
- `complete-job.use-case.ts`, `cancel-job.use-case.ts`.
- `resolveJobActor` authorization helper + Section 9's authorization model, fully enforced.
- Server Actions for complete-appointment, complete-job, cancel-job.
- The full concurrency guard set from Section 14.
- Integration tests covering Sections 15's authorization, state-transition, invalid-transition, and concurrency matrices at minimum for complete-appointment/complete-job/cancel-job.

## 18. SHOULD IMPLEMENT NOW

- `start-job.use-case.ts` + Server Action (pending the Option A/B product decision in Section 6 — if the product owner picks Option A instead, this item drops and `startedAt` is set implicitly by `complete-appointment`).
- List/detail read-side use cases and pages (customer "My Jobs," professional "My Jobs," job detail pages).
- Chat notification extension (`COMPLETED` on `AppointmentEventType`, new `JobEventType`/`JobNotifier`) — high value, low risk, follows an existing pattern exactly.
- `job-status-badge.tsx` and the job-progress panel on the existing ServiceRequest detail page.
- ServiceRequest/Quote/Appointment/Job consistency tests (Section 15).

## 19. CAN BE DEFERRED

- Any "reopen a completed job" mechanism — genuinely belongs to Module 21 (Disputes) and has no clear shape without that module's design.
- Real `Notification` model writes for job events (start/complete/cancel) — the platform has zero real Notification-writing code anywhere yet; Module 11 can rely on the chat SYSTEM-message pattern alone for now, same as Module 10 did, without regressing anything.
- `Payment`/`Review`/`Dispute`/`Commission`/`Payout`/`Transaction` gaining a `jobId` FK — explicitly Modules 12/13/21/22's own decision, not Module 11's to make speculatively.
- AuditLog entries for Job actions — nice-to-have, no other module currently writes AuditLog either, so Module 11 isn't regressing a convention by deferring it.
- A `NO_SHOW`-equivalent Job status or any automated no-show detection — Module 10 already explicitly deferred this at the Appointment level; no new reason for Module 11 to pick it up first.
- Company-side (as opposed to solo-professional) full support for job actions — Module 10's own booking use cases already flag company-owned appointment ownership resolution as unimplemented; Module 11 inherits that same limitation rather than being the module that first solves it.

---

## 20. Recommended Implementation Order

1. **Schema first, in isolation**: `Job` model, enums, `Appointment.jobId`, migration + backfill. Verify against existing data (or a seeded dev DB) before any application code depends on it.
2. **Domain layer**: `job-state.ts`, unit tests for every predicate/transition (mirroring `appointment-state.test.ts`'s structure) — this is cheap, fast-to-write, and de-risks every use case built on top of it.
3. **Repository layer**: `JobRepository` interface, then `PrismaJobRepository`, with its own focused tests for the `expectedStatuses` guard and the transactional "no non-terminal appointments" recheck in `complete`.
4. **Wire Job creation into `QuoteAcceptanceRepository.acceptQuote`** — extend its existing transaction, re-run `booking-flows.test.ts`'s double-acceptance test with an added assertion on Job count to confirm the "closed by construction" claim in Section 14 actually holds.
5. **`complete-appointment.use-case.ts`** — the standalone, lowest-dependency piece; can be built and tested (including its chat-notifier extension) independent of everything Job-related, since it only touches `AppointmentRepository`.
6. **`complete-job.use-case.ts`, `cancel-job.use-case.ts`**, then `start-job.use-case.ts` once Section 6's Option A/B decision is made — each with its full authorization + concurrency test coverage before moving to the next.
7. **Server Actions + DTOs**, thin wrappers over the now-tested use cases.
8. **UI**: professional "My Jobs" list/detail first (primary actor for most actions), then the appointment-detail "mark completed" button, then customer-side read views, then the ServiceRequest-detail job-progress panel last (lowest-risk, purely additive).
9. **Full integration test matrix** (Section 15) as a final pass, explicitly re-checking every concurrency scenario from Section 14 against the real Prisma implementation (not just the fakes), the same way `appointment-lifecycle.test.ts` already does for Module 10's races.

---

*End of audit. No files, schema, or migrations were modified in the production of this report, per the audit-only scope of this task. Awaiting direction before any implementation begins.*
