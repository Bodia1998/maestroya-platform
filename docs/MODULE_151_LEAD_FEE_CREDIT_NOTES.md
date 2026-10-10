# Module 151 — Lead-Fee Credit Notes

Status: implemented on the M151 working tree (unstaged). Scope: LEAD_V1 only.

**This module records a credit note that fully cancels one M150 lead-fee invoice. It does NOT claim that the recorded
credit note is legally compliant, it does NOT refund anything, and it is NOT wired to any route, Server Action, webhook,
job or queue.** The repository contains no reviewed legal/accounting policy for credit notes of LEAD_V1 invoices (see
*Unresolved decisions*). Issuance is therefore a **fail-closed** boundary: it only happens for the single scenario the code
can represent without inventing policy — a FULL credit of one existing, internally consistent invoice — and only when an
operator has supplied an explicit, credit-note-specific approval reference. Nothing in the code, the schema or this
document should be read as a statement that the generated records satisfy Spanish invoicing rules.

## 1. What it does

For ONE existing M150 lead-fee invoice it can record ONE immutable credit note that credits the invoice **in full** (net,
IVA and total exactly as invoiced). The credit note is its own document with **positive** credited amounts — it is not a
negative invoice — that references the invoice and carries snapshots of the invoice number / issue time, the amounts, the
issuer and the recipient, all copied from the invoice (never from today's billing identity or pricing configuration).

The invoice (M150) and the M149 ledger entry are never edited or deleted: the credit note is a new row in a new table.

Not implemented (deliberately): partial credits, multiple credit notes per invoice, refunds / Stripe calls (M153), revoking
lead access, balance changes, changing the lead-purchase status, reconciliation (M152), PDF / e-mail / in-app delivery, a UI,
automatic issuance, an admin console (M157), cancellation or correction *of a credit note*.

## 2. Policy actually enforced

| Question | Decision in code | Why |
|---|---|---|
| Which invoices can be credited? | Any persisted M150 invoice that is internally consistent: well-formed `LFI-` number, net > 0, tax ≥ 0, total = net + tax (exact Decimal), `EUR`, a known M136 tax-policy version whose rate and IVA amount are re-verified, recipient tax country and country `ES`, issuer not the placeholder. | These are the same properties M150 verifies at issuance; nothing new is invented. |
| Does the lead purchase have to be REFUNDED / REVOKED / still CONFIRMED? | **Not checked.** Eligibility is a property of the invoice. The purchase status is neither read nor changed. | When a credit is *allowed* is a legal/product decision (D-1, D-2). Coupling it to a purchase status would invent that rule, and a credit note after a refund is the typical case. |
| Full or partial? | **Full only.** Requested amounts, if supplied, must equal the invoice's; a smaller amount → `PARTIAL_CREDIT_NOT_SUPPORTED`; a larger one → `CREDIT_EXCEEDS_INVOICE`; malformed / negative / zero / non-2-decimal → `INPUT`. | No documented rule says partial credits are allowed or how IVA would be apportioned (D-3). |
| How many per invoice? | **One** (unique index on the invoice id). | With full-only credits a second one would always over-credit, so cumulative over-credit is impossible by construction; no cumulative-sum logic is needed (or invented). |
| Currency / precision | `EUR` only (DB CHECK and domain); `Decimal(10,2)`, decimal strings and `bigint` fixed-point; no JS float anywhere. | M150 convention. |
| Who is the issuer? | The configured issuer (M150 variables) must be the entity that issued the invoice (`ISSUER_MISMATCH` otherwise); the snapshot is the invoice's. | A credit note must come from the same legal entity; a mismatch needs a human decision. |
| Reason | Required plain text, 1–500 chars, no control characters; stored as given (trimmed). It is **not** legal wording and carries no policy meaning. | Audit trail without inventing a reason taxonomy. |

## 3. Lifecycle

```
[M150 invoice exists]  --> IssueLeadFeeCreditNoteUseCase.execute({ leadPurchaseId, reason, requestedAmounts? })   (trusted-internal; called by nothing today)
   1. input is a UUID                                         else INPUT
   2. reason is valid                                         else CREDIT_REASON_INVALID
   3. invoice exists for that purchase (M150 port)            else INVOICE_NOT_FOUND
   4. credit note already exists for the invoice?             --> return it (created:false); config is not re-read, no number consumed
                                                                  (requested amounts that differ from it -> PARTIAL_CREDIT_NOT_SUPPORTED)
   5. operator config: approval reference + issuer            else POLICY_NOT_APPROVED / ISSUER_NOT_CONFIGURED
   6. invoice well-formed, EUR, known tax policy, IVA verified, ES recipient
                                                              else INVOICE_INVALID / UNSUPPORTED_CURRENCY / UNSUPPORTED_TAX_POLICY /
                                                                   TAX_AMOUNT_INCONSISTENT / UNSUPPORTED_RECIPIENT_COUNTRY
   7. configured issuer = invoice issuer                      else ISSUER_MISMATCH
   8. requested amounts (if any) = invoice amounts            else CREDIT_EXCEEDS_INVOICE / PARTIAL_CREDIT_NOT_SUPPORTED / INPUT
   9. repository.issue(draft) — ONE DB transaction (see §4)
        |
        v
   ISSUED credit note row (immutable). There is no draft/cancelled state; a row exists only once issued.
```

Every rejection is a `LeadFeeCreditNoteNotIssuableError` (`code = LEAD_FEE_CREDIT_NOTE_NOT_ISSUABLE`) with a closed `reason` and a
static message that never carries a tax id, name, address or the reason text. Rejections persist nothing and allocate no
number. Unexpected errors (database, read failures) propagate; they are never converted into a credit note or swallowed.

The use case is **trusted-internal**: `leadPurchaseId` must come from a persisted record, the result contains the recipient's tax
id and address, and it is constructed only by `use-cases/lead-fee-credit-note/compose.ts`, which no route, Server Action,
webhook, job or UI imports (static test).

## 4. Idempotency, concurrency, numbering, rollback

1. **Replay short-circuit** — an existing credit note for the invoice is returned before any configuration check.
2. **Per-invoice advisory lock** — `pg_advisory_xact_lock(hashtext('lead_fee_credit_note'), hashtext(<invoiceId>))` first in the
   issuing transaction: concurrent attempts queue; the losers see the winner's row and return it (`created:false`) **without
   allocating a number**.
3. **Number allocated in the same transaction** — `allocateNextDocumentSequence(tx, "LFC", year)` (the existing atomic
   `invoice_number_counters` upsert). If the insert (or the INSERT trigger) fails, the counter increment rolls back: no burned
   number — as for M150.
4. **DB unique indexes** — `creditNoteNumber` and `leadFeeInvoiceId`: the final arbiter (a `P2002` race resolves to the winner's row).
5. **INSERT trigger / CHECKs / append-only trigger** — §5.

Numbering: series `LFC`, format `LFC-YYYY-NNNNNN`, sequence per (series, year) in Spanish civil time (`Europe/Madrid`). Distinct from
M150 `LFI-` and the legacy `INV-` / `CN-`; the DB CHECKs pin the `LFC-` prefix on the credit-note number and the `LFI-` prefix on the
referenced invoice number, so the series cannot collide. **The series/format is provisional (decision D-5).**

## 5. Schema and migration

`prisma/migrations/20261015000000_add_module_151_lead_fee_credit_notes/migration.sql` — additive only: one table
`lead_fee_credit_notes` (Prisma `LeadFeeCreditNote`), reusing the existing `BillingEntityType` enum; no existing table, column, row,
trigger or enum is altered or backfilled. The only `schema.prisma` change to an existing model is the **relation field**
`LeadFeeInvoice.creditNote` (no database column; the invoice table is unchanged).

* Unique: `creditNoteNumber`, `leadFeeInvoiceId`. Indexes on `leadPurchaseId`, `(professionalProfileId, issuedAt)`, `issuedAt`.
* FK `leadFeeInvoiceId → lead_fee_invoices(id)` **ON DELETE RESTRICT**.
* CHECKs: credited net > 0, tax ≥ 0, total = net + tax, rate 0..10000 bps; `creditNoteNumber ~ ^LFC-\d{4}-\d{6,}$` and
  `originalInvoiceNumber ~ ^LFI-\d{4}-\d{6,}$`; `creditKind = 'FULL'`; `currency = 'EUR'`; country-code shapes; mandatory text non-blank;
  `issuerTaxId <> 'PENDING-CIF-CONFIRMATION'`.
* `BEFORE INSERT` trigger `lead_fee_credit_notes_validate_insert`: the invoice must exist and every reference, snapshot and amount of the
  row (invoice number / issue time, ledger entry, purchase, lead, professional, currency, rate, policy version, the three amounts, issuer,
  recipient) must be identical to the invoice's. This is what makes partial and over-credits impossible even for a writer that bypasses
  the application.
* `BEFORE UPDATE OR DELETE` trigger: the credit note is append-only (TRUNCATE is unaffected, as for the invoice/ledger/tests).
* Rollback (only if no credit note must be kept): drop the table and the two functions; optionally delete the `LFC` counter rows.

M149 and M150 stay append-only and writer-restricted: the credit-note adapter never references the invoice, ledger, purchase or
billing-identity tables, and a static test pins this. The invoice is read only through the existing M150 port
(`findByLeadPurchaseId`).

## 6. Code map

| Piece | File |
|---|---|
| Pure rules, typed rejection, config resolver, number format | `src/core/domain/services/lead-fee-credit-note.ts` |
| Repository port | `src/core/domain/repositories/lead-fee-credit-note-repository.ts` |
| Prisma adapter | `src/core/infrastructure/database/prisma/repositories/prisma-lead-fee-credit-note-repository.ts` |
| Use case | `src/core/application/use-cases/lead-fee-credit-note/issue-lead-fee-credit-note.use-case.ts` |
| Composition root (manual DI) | `src/core/application/use-cases/lead-fee-credit-note/compose.ts` |
| Migration / model | `prisma/migrations/20261015000000_…/migration.sql`, `prisma/schema.prisma` |

No legacy credit-note code (`CreditNote`, `CreateCreditNoteUseCase`, `calculateTaxReversal`, the `CN` allocator, self-billing) is reused or
modified; only the shared atomic counter helper `allocateNextDocumentSequence`, the pure `isPlaceholderIssuerTaxId` predicate and M150's pure
helpers (supported tax policies, issuer env resolver, civil-year function) are shared. The legacy credit note is job-based (commission / IRPF
reversal), a different tax object, and is not suitable for LEAD_V1.

## 7. Operator gates that keep issuance closed

Issuance is refused unless **all** of these hold at call time (read on every call, no fallbacks, no placeholder accepted):

| Gate | Variable / mechanism |
|---|---|
| Issuer configured | `MAESTROYA_ISSUER_LEGAL_NAME`, `MAESTROYA_ISSUER_TAX_ID` (not `PENDING-CIF-CONFIRMATION`), `MAESTROYA_ISSUER_ADDRESS` — and equal to the invoice's issuer |
| Credit-note policy approval | `LEAD_FEE_CREDIT_NOTE_POLICY_APPROVAL_REF` — **separate** from `LEAD_FEE_INVOICE_POLICY_APPROVAL_REF`; stored on every credit note. It records *a reference*; it does not verify a review took place (D-8). |
| Trusted caller | The use case is reachable only from code that imports `compose.ts`; today nothing does. |

Approval is never inferred from `NODE_ENV`, CI flags or any other variable (unit-tested).

## 8. Compatibility with M146–M150

* **M146** — not consumed at all: the recipient is the invoice's frozen snapshot.
* **M147 / M148** — untouched.
* **M149** — not read, not written, not referenced by the credit-note adapter; the ledger table, adapter and trigger are unchanged.
* **M150** — read-only consumer through `LeadFeeInvoiceRepository.findByLeadPurchaseId`. The invoice table, adapter, domain service, use case and
  migration are unchanged. The only edit to an M150 file is the closed list of known invoice consumers in
  `tests/unit/prisma/lead-fee-invoice-boundary-m150.test.ts`, extended with the three M151 files that name the invoice (the same practice M150
  followed for the M146 boundary test); no M150 behaviour changed.
* **M140 / M141** — unchanged; payment, webhook and confirmation never reference credit notes (static test).

## 9. Tests

See the final report for what was actually executed and the result of each run; this file only lists what exists.

| Layer | File |
|---|---|
| Domain rules (full-credit policy, decimals, every rejection reason, config, numbering/year) | `tests/unit/core/domain/services/lead-fee-credit-note-m151.test.ts` |
| Use case (valid, nonexistent invoice, gates, partial/over-credit, replay, concurrent calls, rollback) | `tests/unit/core/application/use-cases/lead-fee-credit-note/issue-lead-fee-credit-note-m151.test.ts` |
| Prisma adapter call contract (mocked client — **not** proof of DB behaviour) | `tests/unit/core/infrastructure/database/prisma/repositories/prisma-lead-fee-credit-note-m151.test.ts` |
| Static boundary (writers, legacy isolation, no side effects, no automatic trigger, M149/M150, migration additivity) | `tests/unit/prisma/lead-fee-credit-note-boundary-m151.test.ts` |
| **Real PostgreSQL** (constraints, triggers, concurrency, rollback, numbering, snapshot, isolation, M149/M150 regression) | `tests/integration-db/lead-fee-credit-note/lead-fee-credit-note-m151.test.ts` |
| Fixtures / in-memory fake | `tests/test-utils/lead-fee-credit-note-fixtures.ts`, `tests/test-utils/fake-lead-fee-credit-note-repository.ts` |

## 10. Unresolved legal / accounting / product decisions (NOT decided here)

1. **D-1 When a credit is allowed** — which events justify a credit note (refund, quality claim, chargeback, duplicate charge, error in the
   invoice), who decides, and whether it depends on the purchase / payment state. M151 imposes no such condition.
2. **D-2 Legal form of the correction** — whether a "credit note" is the correct document (versus a corrective/rectifying invoice under
   RD 1619/2012 art. 15 or an invoice cancellation), its mandatory content, wording and language, how it references the original, and
   deadlines/time limits for issuing it. Not asserted here.
3. **D-3 Partial credits** — whether they exist, how IVA is apportioned, rounding, cumulative limits. Only the full credit is representable.
4. **D-4 VAT treatment of the credit** — the credit copies the invoice's M136 21% pilot amounts; behaviour for other IVA cases, adjustments of the
   declared tax period and the Canarias/Ceuta/Melilla/EU cases remain unresolved (M150 D-5 applies in full).
5. **D-5 Numbering** — series, prefix, format, per-year reset, whether a separate or the same series as invoices is required, gap policy.
   `LFC-YYYY-NNNNNN` is provisional.
6. **D-6 Issue date** — `issuedAt` is the system clock; which date is legally relevant for the correction is undecided.
7. **D-7 Issuer / operating model** — the issuer entity, CIF, address (M150 D-1, D-6) are still operator-supplied and unverified.
8. **D-8 Approval mechanism** — `LEAD_FEE_CREDIT_NOTE_POLICY_APPROVAL_REF` is an operator-set gate that records a reference; it does not verify that a
   review took place.
9. **D-9 Money movement** — refund execution, Stripe fee treatment, professional balances and access revocation belong to M153/M155 and are not
   triggered; whether a credit note must be paired with a refund (or vice versa) is undecided.
10. **D-10 Reconciliation and reporting** — how credit notes enter the M149 ledger / revenue reporting and the AEAT reporting (no ledger reversal entry type
    exists; M149 §D-3/D-6) — M152.
11. **D-11 Document, delivery, retention, GDPR** — PDF/format, storage, delivery, language, retention and technical enforcement, erasure interplay (the credit note
    stores the recipient's data and is not cascade-deleted).
12. **D-12 Trigger and authority** — who/what may issue credit notes (admin console M157, automatic after refund, on request) and who may read them.

## 11. Exact gates preventing production issuance

1. No code path calls the use case (composition root imported by nothing; pinned by `lead-fee-credit-note-boundary-m151.test.ts`).
2. `LEAD_FEE_CREDIT_NOTE_POLICY_APPROVAL_REF` unset → `POLICY_NOT_APPROVED`.
3. Issuer variables unset / placeholder / different from the invoice's issuer → `ISSUER_NOT_CONFIGURED` / `ISSUER_MISMATCH`.
4. Only full credits of EUR, ES-recipient, known-tax-policy invoices are representable; everything else is rejected, in the application and again by the database.
5. Decisions D-1…D-12 above are open. Passing tests does not make this production-ready.

## 12. Deferred to later modules

M152 reconciliation of invoices / credit notes against the ledger and provider · M153 refund execution · M154 quality claims · M155 chargebacks / access
revocation · M156 fraud controls · M157 admin console (including any manual issuance UI) · M158 retention / GDPR policy. Also deferred: partial credits,
PDF generation and delivery, automatic issuance, a read model / UI for credit notes.
