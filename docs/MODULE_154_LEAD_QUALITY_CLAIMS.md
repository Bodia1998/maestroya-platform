# Module 154 — Lead Quality Claims Workflow (Part A: claim and decision only)

Status: **Part A implemented. The module is NOT complete against the roadmap.** Nothing in the application calls it (no route, Server Action,
webhook, job, subscriber, notification or admin UI). **A claim decision is not a refund.** No refund is created, requested, queued or implied.

## 1. Deferred roadmap acceptance (read this first)

The roadmap's M154 acceptance criterion **"approval produces exactly one refund" is NOT met and is deliberately deferred ("Part B", not authorized).**
Part A records an approval as a *decision only*. Specifically, this module does **not**:

* add `CLAIM_APPROVED` to Module 153 (refund reason enum, TypeScript union, CHECKs or triggers are untouched — `CLAIM_APPROVED` still does not exist anywhere);
* link a claim to a refund attempt, call `ExecuteLeadFeeRefundUseCase`, touch a payment gateway/Stripe, the purchase status, the ledger, invoices or credit notes;
* publish an event or send a notification.

Whether (and under which rules) an approved claim may ever lead to money is an open owner decision (D12). M153 still guards refunds behind its two OFF-by-default
switches and defines `PLATFORM_ERROR` as excluding lead quality. When Part B is authorized it must go through M153's own use case, checks and switches.
Never report an approved claim as a completed refund.

## 2. What it does

| Use case | Actor | Effect |
|---|---|---|
| `SubmitLeadQualityClaimUseCase` | the authenticated **buyer** (session user id) | creates a `SUBMITTED` claim for their own CONFIRMED purchase |
| `StartLeadQualityClaimReviewUseCase` | ACTIVE `ADMIN` / `SUPER_ADMIN` | `SUBMITTED -> UNDER_REVIEW` |
| `DecideLeadQualityClaimUseCase` | ACTIVE `ADMIN` / `SUPER_ADMIN` | `SUBMITTED \| UNDER_REVIEW -> APPROVED \| REJECTED`, explanation mandatory for both |

Composition root: `makeSubmitLeadQualityClaimUseCase`, `makeStartLeadQualityClaimReviewUseCase`, `makeDecideLeadQualityClaimUseCase`
(`src/core/application/use-cases/lead-quality-claim/compose.ts`, imported by nothing).

### Approved parameters

* Reasons (closed): `CONTACT_UNREACHABLE`, `CONTACT_INVALID`, `DUPLICATE_LEAD`. Workmanship, service quality, the customer's final price, lack of agreement,
  customer non-response and professional conduct are **not** claim reasons. Claim reasons and M153 refund reasons are disjoint vocabularies.
* Claim window: **72 hours after the purchase's `confirmedAt`** (inclusive), exactly one claim per purchase.
* Response target: `respondBy = submittedAt + 72 hours`. A target, **never an automatic decision**; nothing acts on it.
* Limits per professional: at most **3 open** claims (`SUBMITTED`, `UNDER_REVIEW`) and at most **10 claims submitted in a rolling 30 days** (all statuses).

## 3. Security and integrity

* **Identity.** The professional is resolved from the session user via the existing `ProfessionalRepository.findByUserId`; the only client-chosen references are the
  purchase id, reason, description and optional evidence id. The purchase's owner, lead and money always come from the database. The professional profile must be `ACTIVE`.
* **No existence probing.** No profile, an inactive profile, an unknown or malformed purchase id, someone else's purchase and a purchase that is not CONFIRMED all produce the same
  `PURCHASE_NOT_CLAIMABLE` rejection with no detail. Window / duplicate / limit answers are reachable only by the purchase's own active professional.
* **Admins.** Authorization is enforced in the use case: the admin is re-read through the existing `AdminRepository.getUserById` on **every** call (must exist, be `ACTIVE`, hold `ADMIN`
  or `SUPER_ADMIN`; a lookup failure denies). The role list is a local constant pinned to the real `ROLES` by a drift test (domain layer imports no infrastructure RBAC).
* **State machine.** `SUBMITTED -> UNDER_REVIEW | APPROVED | REJECTED`, `UNDER_REVIEW -> APPROVED | REJECTED`; `APPROVED` / `REJECTED` are terminal. Repeats and reversals are
  `INVALID_TRANSITION`. Writes are status-conditional (`UPDATE ... WHERE status IN (...)`), so when two decisions race exactly one wins; a database trigger enforces the same rules.
* **Free text.** `description` (10–1000 chars) and the decision `explanation` (1–1000 chars) are trimmed, never truncated, and obvious e-mail addresses, URLs and phone-like digit runs are rejected.
  This is a **heuristic, not a guarantee** that no personal data is present. Evidence is an optional **opaque id** (`[A-Za-z0-9][A-Za-z0-9._:/#-]*`, ≤ 200), not free text.
* **Audit.** Every transition is recorded through the existing append-only `AdminAuditLogRepository` (new action names `LEAD_QUALITY_CLAIM_SUBMITTED / _REVIEW_STARTED / _APPROVED / _REJECTED`,
  mapped to the closest existing `AuditLogAction`). Metadata holds ids, the reason code and the status change only — never the description, explanation or contact data.
* **No financial data.** The table and DTOs have no amount, currency, payment reference, refund, ledger, invoice or credit-note field.

## 4. Persistence

Migration `20261017000000_add_module_154_lead_quality_claims` (additive, hand-authored; rollback notes in its header): two enums and the table `lead_quality_claims`. The Prisma model is
scalar-only (its foreign keys exist in SQL only), so **no existing Prisma model, table, enum, trigger or row is modified**; M153 and the purchase triggers are untouched.

Database guarantees (each exercised by the real-PostgreSQL suite):

* `UNIQUE (leadPurchaseId)` — one claim per purchase.
* INSERT trigger: bare `SUBMITTED` row; purchase must exist, be `CONFIRMED` and belong to the claiming professional; the trigger **stamps `submittedAt` from the database clock and derives `respondBy = submittedAt + 72h`**
  (whatever the client sent; hardening migration `20261018000000`) and requires `confirmedAt <= submittedAt <= confirmedAt + 72h` — **inclusive at both ends**: a claim at exactly
  `confirmedAt + 72h` is accepted, one millisecond later is refused (`lead_quality_claims_window_open()`); **3-open and 10-per-30-days limits**.
* CHECKs: `respondBy = submittedAt + 72h` (a backstop: the trigger already derives it); text lengths; status ↔ review/decision field consistency.
* UPDATE trigger: identity/content immutable; review and decision fields write-once; status forward-only. The same trigger refuses a review-start or decision recorded for the user who owns the claim's professional profile (separation of duties backstop). DELETE trigger: rows are never deleted (history is kept; `ON DELETE RESTRICT` foreign keys).

### Concurrency — what is and is not guaranteed

* The insert trigger first takes `SELECT ... FOR UPDATE` on the professional's `professional_profiles` row, so concurrent claim inserts **of one professional are serialized** and each counts the
  previous one. Verified with 5 genuinely concurrent submissions: exactly 3 succeed. Different professionals do not block each other.
* The use case also pre-checks the limits to give a clear answer; the trigger is the authority, and its refusal maps to the same closed codes.
* Limitations: the lock is held until the inserting transaction commits (a long transaction by the same professional would delay others); the rolling period is measured on `submittedAt`;
  the pre-check can be stale (harmless: the trigger decides); the application clock is used only for the advisory pre-checks and never decides the window or reaches the database. The "claims older than 30 days stop counting" arithmetic
  is covered by domain unit tests, not by a database test (a row cannot be inserted with an old `submittedAt` by design). The exact `+72h` instant is tested on `lead_quality_claims_window_open()`; at trigger level only 30 s inside / 2 s outside is tested, because the database clock cannot be pinned.
* **Atomic audit:** the claim repository writes each transition (submission, review-start, approval, rejection) and its append-only audit entry in ONE database transaction
  (`recordAdminAuditLogWithin`, the existing `AuditLog` mapping). A failing audit insert rolls the transition back and the caller gets the error. Review-start and decision lock the claim row
  (`SELECT ... FOR UPDATE`), record the TRUE previous status in the entry and stamp it with the database clock, so concurrent transitions leave a correctly ordered trail. Audit entries of the
  claim (ids, reason code and status change only) share the claim's fate; the generic `record` used by other modules is unchanged.
* **Separation of duties:** an administrator cannot start the review of, approve or reject a claim of their own professional profile (`ACTOR_NOT_AUTHORIZED`, the same generic error as any
  unauthorized actor, raised before any state check). Ownership is read from persisted records (claim, profile, user), including a soft-deleted profile; the update trigger enforces the same rule.

## 5. Roadmap deviations (the roadmap itself is not edited)

| # | Roadmap | Part A as built |
|---|---|---|
| 1 | "approve → refund"; acceptance "approval produces exactly one refund" | **Not delivered (Part B, not authorized).** Approval is a decision only. |
| 2 | "reason codes per D12" | Three owner-approved codes. |
| 3 | "notifications", "actions", "admin queue (M157 UI)" | None. No notification event, subscriber, route, Server Action or UI. |
| 4 | "SLA timestamps" (D22) | `respondBy` target only; nothing enforces or escalates it. |
| 5 | Tests: "integration with refund use case" | Deliberately absent; static tests prove there is no such integration. |
| 6 | Exit: "workflow exercised in internal testing" | Not claimed; there is no entry point yet. |

## 6. Known limitations

* No caller exists until M157; the admin use cases validate the admin themselves but a future caller should still gate with `requireRole`.
* A claim can be decided after its purchase was REFUNDED/REVOKED by another path; the decision is independent and nothing reconciles the two.
* The professional's `ACTIVE` status is checked in the use case, not by the database trigger.
* Claim abuse signals for M156 are not published (no events); M156 would read the table.
* No claim withdrawal or reopen exists (not in the approved scope).
