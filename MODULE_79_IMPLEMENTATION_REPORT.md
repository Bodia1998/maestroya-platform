# Module 79 — Invoicing & Credit Notes: Implementation Report

## 1. What was implemented

Module 79 adds a self-billing ("facturación por el destinatario") invoicing
system for the commission relationship **Professional/Company → MaestroYa**,
plus a credit-note system for correcting issued invoices, on top of the
existing Modules 73–78 (payments, refunds, payouts, tax/commission
calculation).

Concretely, this module adds:

- A domain model for **self-billing authorization** — the explicit,
  opt-in fact that a professional or company has agreed MaestroYa may
  issue invoices in their name and on their behalf. Authorization is
  never assumed; every invoice-draft creation checks for an ACTIVE
  authorization and fails closed if none exists.
- A domain model and lifecycle state machine for **professional
  invoices** (DRAFT → PENDING_ACCEPTANCE → ACCEPTED → ISSUED → PAID,
  plus CANCELLED), with immutable, DB-numbered, hash-stamped documents
  once ISSUED, and all transitions enforced by a single domain-level
  state machine rather than scattered controller checks.
- A domain model and lifecycle for **credit notes** as separate,
  independently numbered documents that reference an original issued
  invoice, are capped at its remaining creditable amount, and never
  mutate the original.
- Concurrency-safe, DB-backed sequential numbering for both invoices
  and credit notes (separate series), never derived from timestamps.
- An **application layer** of 10 use cases orchestrating the above,
  consuming (never recomputing) Module 78's tax/commission engine and
  Modules 73/75's Quote/Job/Payment data.
- A **minimal, additive, backward-compatible** integration point in
  Module 76's `ExecuteProfessionalPayoutUseCase` so a payout can
  optionally be gated on the job's invoice having reached the ISSUED
  or PAID state, without changing Module 76's existing behavior when
  the gate is not wired in.
- Domain events, audit-log entries (reusing the existing
  `AdminAuditLog` architecture), and a Prisma migration adding 6 new
  tables and 5 new enums, additively, with no changes to any existing
  table.
- A test suite of **69 new, module-specific tests** (10 domain
  lifecycle, 4 self-billing-authorization-rules, 6 credit-note
  eligibility, 7 invoice-document, 37 application-use-case, and 5
  extending Module 76's payout test file for the new optional gate),
  plus full regression verification across Modules 73–78's existing
  suites (all still passing — see §12).

## 2. Exact business rules implemented

- **Self-billing authorization is opt-in and never assumed.** Creating
  an invoice draft for a professional/company with no ACTIVE
  `SelfBillingAuthorization` row throws
  `SelfBillingNotAuthorizedError` and no invoice is created.
- **Canonical commission example, verified in tests**: labour €1,000 +
  professional-supplied materials €200 = €1,200 base; customer pays
  €1,452 (21% IVA); MaestroYa commission 10% = €120; professional net
  base €1,080; professional IVA 21% = €226.80; professional invoice
  total €1,306.80. This is computed once by Module 78's
  `calculateMaestroYaTaxBreakdown` / `calculateCommissionBreakdown`
  and only ever *read* by Module 79 — never re-derived.
- **Materials handling matches Module 78 exactly**: customer-purchased
  materials (`materialsStrategy === "CUSTOMER_PURCHASED"`) are
  excluded from the professional's invoice base; professional-supplied
  materials (`"PROFESSIONAL_SUPPLIED"`) are included. Module 79 does
  not re-implement this filter — it consumes
  `CalculateJobTaxBreakdownUseCase`'s output as-is.
- **The 10% commission model is untouched.** No Module 79 code computes
  or overrides a commission rate; every commission-derived figure on
  an invoice or credit note is copied verbatim from Module 78's
  breakdown at draft-creation time.
- **DRAFT is the only editable state.** Every other state change goes
  through a named use case, each of which calls the shared
  `canTransitionInvoiceStatus` state machine; an invalid transition
  (e.g. DRAFT → ISSUED directly, or ISSUED → DRAFT) throws
  `InvalidInvoiceTransitionError` before any repository write.
- **ISSUED invoices are immutable.** There is no "edit issued invoice"
  use case or repository method. The only way to correct an issued
  invoice's amounts is a new, separate `CreditNote`.
- **Credit notes are capped at the remaining creditable amount.**
  `assertCreditNoteWithinRemainingAmount` sums prior non-cancelled
  credit notes against the same invoice and throws
  `CreditNoteExceedsRemainingAmountError` if the new request would
  exceed the invoice's issued total.
- **Credit-note creation is idempotent** per `(invoiceId,
  idempotencyKey)` — a retried request with the same key returns the
  existing credit note rather than creating a duplicate (mirrors the
  existing `ExecuteRefundUseCase`/`CreateQuoteUseCase` idempotency
  convention).
- **Cross-professional and nonexistent-invoice credit notes are
  rejected.** `CreateCreditNoteUseCase` loads the invoice, verifies it
  belongs to the requesting professional/company, and verifies it is
  in a creditable state (ISSUED or PAID) before doing anything else.
- **Payout requires the invoice to have reached ISSUED or PAID.** This
  is enforced only when the optional gate is wired in (see §8) via a
  clean application-level eligibility check — Module 76 itself is
  unmodified in its core payout-execution logic.

## 3. Invoice lifecycle (state machine)

```
DRAFT --submit--> PENDING_ACCEPTANCE --accept--> ACCEPTED --issue--> ISSUED --mark paid--> PAID
  |                      |                          |
  +---------------- cancel (any of DRAFT/PENDING_ACCEPTANCE/ACCEPTED) ----------------+
                                                                                 CANCELLED
```

Implemented as a pure function,
`canTransitionInvoiceStatus(from, to): boolean`, in
`src/core/domain/services/invoice-lifecycle.ts`, consulted by every
use case before any repository write (repositories additionally
enforce it again at the SQL layer via compare-and-swap `UPDATE ...
WHERE status = ANY($fromStatuses)`, so a race between two callers can
never silently apply two transitions from the same starting state).
ISSUED and PAID are the two states from which no further edits to the
invoice's financial content are possible; CANCELLED and PAID are
terminal.

`satisfiesPayoutInvoicePrerequisite(status)` — used only by the
optional payout gate — returns true for ISSUED or PAID only,
deliberately excluding ACCEPTED, because only ISSUED invoices are
numbered/immutable, and because the PAID transition is only valid
*from* ISSUED (an ACCEPTED invoice reaching PAID via a payout-executed
event would otherwise throw `InvalidInvoiceTransitionError` inside an
event subscriber, silently stranding the invoice — see §12 for the
regression test verifying this).

## 4. Self-billing authorization model

`SelfBillingAuthorization` (one ACTIVE row at a time per professional
or per company, enforced by a partial unique index, full history
preserved via revoke-then-reissue rather than mutation) records:

- `status` (ACTIVE / REVOKED)
- `agreementVersion` — an identifier (e.g.
  `"self-billing-agreement-es-v1"`) resolved against whatever
  versioned agreement-text store the product owner maintains. **The
  legal text of the agreement itself is out of this module's scope
  and is not stored here** — see §16.
- `acceptedByUserId` and `acceptedAt` — who accepted and when, always
  supplied by the use case from the authenticated session, never
  inferred.
- `acceptanceIpAddress` / `acceptanceUserAgent` — best-effort audit
  evidence only.
- `revokedAt` / `revokedByUserId` for the revocation path.

This is explicitly **not** an electronic-signature system and makes no
claim of producing a qualified electronic signature under eIDAS or
Spanish law — it is a record of an authorization event with
supporting evidence, matching exactly what the brief asked for.

## 5. Electronic acceptance model (invoice acceptance)

`AcceptInvoiceUseCase` transitions PENDING_ACCEPTANCE → ACCEPTED and
records `acceptedAt` / `acceptedByUserId` on the `Invoice` row itself,
gated by:

1. The invoice must currently be PENDING_ACCEPTANCE (state machine).
2. An ACTIVE `SelfBillingAuthorization` must exist for the invoice's
   professional/company at acceptance time (re-checked, not assumed
   from draft-creation time, since authorization can be revoked in
   between).

As with §4, no claim of a qualified electronic signature is made
anywhere in code, tests, or this report.

## 6. Credit-note model

`CreditNote` is a standalone document type, independently numbered
(`CN-...` series, separate counter from `INV-...`), that:

- References exactly one original `Invoice` (FK, never nullable).
- Has its own lifecycle (`DRAFT → ISSUED`, plus `CANCELLED`), enforced
  by `canTransitionCreditNoteStatus`, independent of the parent
  invoice's own lifecycle.
- Derives its tax/commission reversal amounts via
  `CreateCreditNoteUseCase.deriveReversal`, which converts the
  requested professional-side credit amount into an equivalent
  customer-side `refundedGrossAmount` using the ratio
  `professionalInvoiceGrossTotal / customerGrossTotal = (1 -
  commissionRate)` (a constant independent of the base amount, proven
  in that method's doc comment), then delegates the actual tax/IRPF
  math to Module 78's existing `calculateTaxReversal` — never
  duplicating tax logic. This ratio-based conversion is a proportional
  estimate; see §16 for the caveat already flagged by Module 78's own
  report for `calculateTaxReversal` itself, which applies equally
  here.
- Is capped at the invoice's remaining creditable amount (§2) and
  never modifies the original `Invoice` row.
- Idempotent creation as described in §2.

## 7. Database / schema changes

All changes are additive; no existing table, column, or migration was
altered.

**New enums** (`prisma/schema.prisma`, after the existing
`AuditLogAction` enum): `SelfBillingAuthorizationStatus`,
`InvoiceStatus`, `InvoiceType`, `InvoiceLineItemCategory`,
`CreditNoteStatus`.

**New tables** (migration
`prisma/migrations/20260906000000_add_invoicing_and_credit_notes/migration.sql`):

- `self_billing_authorizations` — party FK (professional XOR
  company, `num_nonnulls(...) = 1` CHECK), status, agreement/
  acceptance/evidence columns, partial unique index enforcing at most
  one ACTIVE row per professional and per company.
- `invoices` — party FK (`num_nonnulls(...) = 1`), FK to `jobs`,
  status, type, document number (nullable until ISSUED, unique when
  present), document hash, all money columns as `Decimal(10,2)`,
  lifecycle timestamps, partial unique index
  `invoices_active_job_unique` enforcing at most one
  non-CANCELLED invoice per job.
- `invoice_line_items` — FK to `invoices`, category, description,
  quantity, unit price, line total, `sortOrder`.
- `credit_notes` — FK to `invoices`, party FK
  (`num_nonnulls(...) <= 1`, denormalized reference), status, own
  document number/hash, reversal amount columns, idempotency key
  (unique per invoice).
- `credit_note_line_items` — FK to `credit_notes`, mirrors
  `invoice_line_items`' shape.
- `invoice_number_counters` — `(series, year)` unique, single
  `lastValue` column, atomically incremented via `INSERT ... ON
  CONFLICT (series, year) DO UPDATE SET "lastValue" = "lastValue" + 1
  ... RETURNING "lastValue"` for concurrency-safe numbering.

All FKs, indexes, and `NOT NULL`/`CHECK` constraints follow the exact
conventions already established by the `Payout`/`Commission`/`Quote`
tables (verified against the existing migrations before writing
this one). Relation fields were added to `User`,
`CustomerProfile`, `ProfessionalProfile`, `CompanyProfile`, `Quote`,
`Job`, and `Payment` to support the new FKs; no existing column on
any of those models was changed.

## 8. Integration with Modules 73–78

- **Module 73 (Payments) / Module 75 (Quotes/Jobs)**: consumed
  read-only via existing repository interfaces to resolve a Job's
  Quote, line items, and payment amounts when building an invoice
  draft. No changes to either module.
- **Module 76 (Payouts)**: `ExecuteProfessionalPayoutUseCase` gained
  two new **trailing, optional** constructor parameters —
  `invoiceGate?: CheckInvoiceRequiredForPayoutUseCase` and
  `requireInvoiceForPayout = false`. When `invoiceGate` is not
  supplied (the default), behavior is byte-for-byte identical to
  before this module; all 18 pre-existing tests in
  `execute-professional-payout.use-case.test.ts` pass unmodified. When
  wired (currently wired with `requireInvoiceForPayout = false` in
  `payments/compose.ts`, i.e. present-but-permissive pending a
  product decision on the rollout date — see §16), a payout for a job
  without an ISSUED/PAID invoice throws `ValidationError` before any
  Stripe call is made. A `MarkInvoicePaidOnPayoutExecutedSubscriber`
  subscribes to Module 76's existing `ProfessionalPayoutExecuted`
  event and transitions the corresponding invoice ISSUED → PAID; no
  changes were made to Stripe Connect payout execution itself.
- **Module 77 (Refunds)**: not modified; untouched by this module.
  Regression suite reconfirmed passing (§12).
- **Module 78 (Tax/Commission)**: `CalculateJobTaxBreakdownUseCase`
  and `calculateTaxReversal` are consumed as opaque, authoritative
  sources by `CreateProfessionalInvoiceDraftUseCase` and
  `CreateCreditNoteUseCase` respectively. Module 79 contains no
  reimplementation of commission-rate lookup, IVA calculation, or
  IRPF withholding math.

## 9. Audit trail and domain events

Ten new `AdminAuditAction` values were added
(`SELF_BILLING_AUTHORIZATION_GRANTED/REVOKED`,
`INVOICE_CREATED/SUBMITTED_FOR_ACCEPTANCE/ACCEPTED/ISSUED/PAID/CANCELLED`,
`CREDIT_NOTE_CREATED/ISSUED`) to the existing
`AdminAuditLogRepository` enum and mapped in
`PrismaAdminAuditLogRepository`'s existing `ADMIN_ACTION_TO_LOG_ACTION`
table — no parallel audit system was introduced.
`RecordInvoicingAuditLogSubscriber` subscribes to all 9 new domain
events (`self-billing-authorization-granted`, `invoice-created`,
`invoice-submitted-for-acceptance`, `invoice-accepted`,
`invoice-issued`, `invoice-paid`, `invoice-cancelled`,
`credit-note-created`, `credit-note-issued`) and writes one audit
entry per event, following the exact pattern already used by earlier
modules' own audit subscribers. All 9 events extend the existing
`DomainEvent` base class and are published through the existing
`EventBus`/`publishDomainEvent` helper — no parallel event system.

## 10. Files changed / added

**Modified** (8 files): `instrumentation.ts`,
`prisma/schema.prisma`,
`src/core/application/use-cases/payments/compose.ts`,
`src/core/application/use-cases/payments/execute-professional-payout.use-case.ts`,
`src/core/domain/errors/domain-error.ts`,
`src/core/domain/repositories/admin-audit-log-repository.ts`,
`src/core/infrastructure/database/prisma/repositories/prisma-admin-audit-log-repository.ts`,
`tests/unit/core/application/use-cases/payments/execute-professional-payout.use-case.test.ts`.

**Added** (37 files): the full `src/core/application/use-cases/invoicing/`
directory (13 files: 10 use cases, 2 subscribers, 1 `compose.ts`); 9
domain event files under `src/core/domain/events/`; 6 domain files
(`credit-note-eligibility.ts`, `credit-note-lifecycle.ts`,
`invoice-document.ts`, `invoice-lifecycle.ts`, `invoicing-issuer.ts`,
`self-billing-authorization-rules.ts`); 3 domain repository interfaces
(`credit-note-repository.ts`, `invoice-repository.ts`,
`self-billing-authorization-repository.ts`); 4 Prisma repository
implementations under `src/core/infrastructure/database/prisma/repositories/`;
1 migration directory; and the test files listed in §11.

## 11. Tests added

- `tests/unit/core/domain/invoice-lifecycle.test.ts` — 10 tests
- `tests/unit/core/domain/self-billing-authorization-rules.test.ts` — 4 tests
- `tests/unit/core/domain/credit-note-eligibility.test.ts` — 6 tests
- `tests/unit/core/domain/invoice-document.test.ts` — 7 tests
- `tests/unit/core/application/use-cases/invoicing/fakes.ts` — hand-rolled
  in-memory fakes for all Module 79 repository interfaces plus a
  `FakeEventBus`
- `tests/unit/core/application/use-cases/invoicing/invoicing-use-cases.test.ts` — 37 tests
- `tests/unit/core/application/use-cases/payments/execute-professional-payout.use-case.test.ts` — extended
  with 5 new tests under "Module 79 — invoice-state prerequisite
  (optional gate)" (18 pre-existing tests untouched, now 23 total)

**Total new tests: 69**, covering all 24 scenarios enumerated in the
brief that are testable at the domain/application layer (authorization
gating, DRAFT creation with immutable snapshots, all valid and invalid
lifecycle transitions, acceptance with authorization/evidence checks,
concurrency-safe numbering uniqueness, credit-note referencing/
capping/idempotency/non-mutation, Module 78 value reuse, unchanged
commission values, CUSTOMER_PURCHASED-vs-PROFESSIONAL_SUPPLIED
materials handling, payout-cannot-bypass-invoice-state, and the
expected domain/audit events).

## 12. Full test results

Because this sandbox cannot run the entire `tests/unit` suite (420+
files) inside a single command within the per-command time
constraint (see §15), the suite was run in sharded chunks
(`vitest run <dir> --shard=k/n`) covering every file in
`tests/unit` exactly once. Results, all green:

| Directory | Files | Tests | Result |
|---|---|---|---|
| `tests/unit/app` | 25 | 126 | ✅ pass |
| `tests/unit/core/domain` (4 shards) | 116 | 1,097 | ✅ pass |
| `tests/unit/core/application` (5 shards, includes Module 79's own suite) | 121 | 864 | ✅ pass |
| `tests/unit/core/infrastructure` (6 shards) | 146 | 1,083 | ✅ pass |
| `tests/unit/presentation` (2 shards) | 49 | 376 | ✅ pass |
| `tests/unit/prisma` + `tests/unit/regression` + `tests/unit/shared` | 14 | 100 | ✅ pass |

**Total: 3,646 tests across ~471 files, zero failures.**

Several chunks additionally reported 1 "Unhandled Error" from Vitest
(e.g. after `admin.dto.test.ts`, `compose.test.ts`,
`language-schema-contract.test.ts`, `root-layout-metadata.test.ts`).
Every one of these was inspected and is the same pre-existing
`Failed to fetch the engine file ... 403 Forbidden` Prisma-engine
network error documented in §15 and in Modules 76/78's own reports —
it is thrown asynchronously by Prisma's engine loader after an
unrelated test file finishes, not by any Module 79 code, and does not
appear in the "Test Files"/"Tests" pass counts above (those files'
own tests are already counted as passed before the async error
surfaces).

Module 79's own new tests (69) and a targeted regression pass across
Modules 73/75/76/77/78's core use-case suites were additionally run
in isolation earlier in this session and passed cleanly with zero
failures, before the full sharded run above was performed.

## 13. Typecheck result

```
npm run typecheck  →  tsc --noEmit
```
**Passed with exit code 0 and no output** (no errors, no warnings).

## 14. Lint result

```
npm run lint  →  eslint .
```
**Passed with exit code 0 and no output** (no errors, no warnings).

## 15. Build and Prisma/migration validation

- **`npx prisma validate`**: fails with `Error: Failed to fetch sha256
  checksum at https://binaries.prisma.sh/.../schema-engine.gz.sha256 -
  403 Forbidden`, reproduced both with and without
  `PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING=1`. This is a pre-existing
  sandbox/network restriction (this environment cannot reach
  `binaries.prisma.sh`), independently documented identically in
  Modules 76 and 78's own implementation reports — it is **not** a
  defect in this module's schema or migration. In its absence, the
  new schema and migration SQL were manually cross-checked
  statement-by-statement against the existing `init` migration's
  conventions (id/timestamp columns, FK naming, `num_nonnulls` CHECK
  usage, `@@map` table names — the latter caught and fixed a real bug,
  see below) and against `prisma format`'s parser, which itself needs
  the same unavailable engine and so could not be run either.
- **`npm run build` (`next build`)**: could not complete within this
  sandbox's per-command time budget. It was attempted directly (cut
  off mid-compile after printing the Next.js banner) and again as a
  detached background process (`setsid nohup npm run build &`,
  polled after 40s); in the background attempt the process was no
  longer running on the next poll and had produced no further output
  or error in its log file, indicating the sandbox does not keep
  session-detached background processes alive across tool-call
  boundaries here. This mirrors the identical, previously documented
  limitation from Module 76's report ("full build cannot complete in
  this sandbox"). Given that `typecheck` and `lint` both pass cleanly
  across the entire repository including all new Module 79 files,
  and every unit test that can be run does pass, there is no evidence
  of a build-breaking defect — but the build's successful completion
  itself is **not confirmed** and should be verified in CI or a
  developer's local machine before merging.

## 16. Remaining risks / legal & accounting items requiring asesor (advisor) confirmation

This section intentionally does **not** claim legal or tax compliance
merely because the technical implementation exists. The following
must be reviewed and confirmed by MaestroYa's tax/legal advisor
(asesor fiscal) before this module is used to issue real invoices:

1. **Issuer identity placeholders.**
   `MAESTROYA_ISSUER_LEGAL_NAME` and `MAESTROYA_ISSUER_TAX_ID` in
   `src/core/domain/services/invoicing-issuer.ts` are placeholder
   values with an explicit doc comment flagging them as such. They
   must be replaced with MaestroYa's real, legally registered
   invoicing identity before any invoice is issued for real.
2. **Self-billing agreement legal text is out of scope.** Only a
   version *identifier* (`agreementVersion`) is stored per
   authorization; the actual agreement wording, its legal
   sufficiency under Spanish self-billing (facturación por el
   destinatario) rules, and how/where that text is presented to the
   professional for acceptance are not implemented here and must be
   supplied and confirmed separately.
3. **Acceptance evidence is not a qualified electronic signature.**
   The IP address / user agent / timestamp captured at acceptance is
   best-effort audit evidence only. Nowhere in this module's code,
   tests, or documentation is it claimed to be equivalent to a
   qualified electronic signature under eIDAS or Spanish law. If a
   qualified signature is legally required for self-billing
   agreements, that is a separate, unimplemented requirement.
4. **Document hash is tamper-evidence, not a legal signature.**
   `computeDocumentHash` (canonical-JSON + SHA-256) lets a later
   party detect if an issued document's recorded content was altered
   after the fact; it makes no claim of being a qualified electronic
   seal/signature on the invoice PDF itself (no PDF generation or
   signing is implemented in this module at all — only the underlying
   data model and numbering).
5. **Credit-note tax reversal is a proportional estimate.** As noted
   in §6, the professional-side credit amount is converted to a
   customer-side reversal via a fixed ratio derived from the
   commission rate, then passed through Module 78's existing
   `calculateTaxReversal`. This carries the same caveat Module 78's
   own report already flagged for that function: it is a
   mathematically consistent proportional allocation, not a
   substitute for an accountant's review of edge cases (e.g. partial
   credits spanning multiple tax periods, IRPF withholding
   thresholds).
6. **Invoice/credit-note numbering series and reset policy.** The
   migration implements a per-`(series, year)` atomic counter, which
   is a common and defensible pattern, but the exact numbering
   *policy* required by Spanish invoicing regulations (e.g. whether
   MaestroYa's own numbering series must be distinguished from each
   professional's pre-existing invoice series, gap-free sequencing
   requirements, etc.) should be confirmed with the asesor before
   go-live.
7. **The Module 76 payout gate is wired but permissive
   (`requireInvoiceForPayout = false`).** The capability to block a
   payout on invoice state exists and is tested (§11), but it is not
   yet enforced by default, pending a product/legal decision on the
   rollout date and on backfilling invoices for jobs paid out before
   this module existed.
8. **`prisma validate`/`prisma generate` and a full `next build` could
   not be executed to completion in this sandbox** (§15) — a
   developer or CI environment with unrestricted network access to
   `binaries.prisma.sh` should run both before merging, as an
   independent confirmation alongside the passing typecheck/lint/test
   results already obtained here.

---

All changes remain **unstaged and uncommitted** on branch
`feature/module-79-invoicing-credit-notes` (verified via `git status`
immediately before writing this report); no `git add`, `git commit`,
`git push`, or any destructive git operation was run at any point
during this work.
