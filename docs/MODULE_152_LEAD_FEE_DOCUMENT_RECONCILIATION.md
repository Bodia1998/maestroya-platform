# Module 152 — Lead-Fee Document Reconciliation

Status: implemented on the M152 working tree (unstaged). Scope: LEAD_V1 only.

**This module is a read-only technical consistency check between the M149 lead-fee revenue ledger, the M150 lead-fee
invoices and the M151 lead-fee credit notes. It is not a statement of legal, tax or accounting compliance** (the report
itself carries that notice). It repairs nothing, resolves nothing, persists nothing, issues no document, starts no refund and
is wired to no route, Server Action, webhook, cron job, queue or scheduler. A finding is evidence for a human reviewer, not a
verdict: in particular, a ledger entry without an invoice is **not** treated as a confirmed violation.

## 1. What it does

`ReconcileLeadFeeDocumentsUseCase.execute()` reads one consistent snapshot of the three document tables (plus the *status* of the
purchases behind the ledger entries), applies the pure rules in `lead-fee-document-reconciliation.ts` and returns a report:
`{ rulesVersion, notice, generatedAt, scope, notEvaluated, summary, findings }`. The same stored data always yields the same
`findings`, `summary`, `scope` and `notEvaluated` in the same order (only `generatedAt` is a clock reading); all money is compared
as fixed-point `bigint` cents, never as a JS float.

It reuses the rules M149–M151 **actually implement** (number patterns, `EUR` only, the known M136 tax-policy version and its IVA
verification, FULL-only credit notes, "year of `issuedAt` in Europe/Madrid") and invents none: no tax calculation, no VAT treatment,
no legal deadline, no accounting definition, and no net-revenue figure — invoices and credit notes are never added together or
netted. The professional's underlying job value is never read.

### Why a new capability and not the existing reconciliation (Module 80 / 92)
The existing framework reconciles legacy **job-based** documents (`Invoice`, `CreditNote`, `Payment`, `Payout`), persists runs and
discrepancies and stores categories in database enums. LEAD_V1 documents live in separate tables on purpose (M150 §6, M151 §6), the
job-centric context does not apply, and extending it would require a schema migration plus persisted state this module does not
need. The two were therefore kept apart; nothing in the legacy framework changed.

## 2. Read-only guarantees

| Guarantee | Mechanism | Evidence |
|---|---|---|
| The port can only query | `LeadFeeDocumentReconciliationReader` has one method, `readSnapshot()` | `lead-fee-document-reconciliation-boundary-m152.test.ts` |
| The adapter issues only `findMany` | no `create/update/delete/upsert`, no `$queryRaw`, exactly one raw statement | same static test |
| The database refuses writes in the run | the adapter's transaction starts with `SET TRANSACTION READ ONLY` (REPEATABLE READ) | static test + PostgreSQL integration test |
| One point-in-time view | single REPEATABLE READ transaction, keyset paging on the primary key | integration test (paging with page size 1, 2, default) |
| No row changes | content **and** row versions (`xmin`) of the ledger, invoices, credit notes, purchases, counters, billing identities, legacy invoices/credit notes, payments and payouts are identical before and after a run (with findings present) | integration test |
| No automatic trigger | composition root imported by nothing; no route/action/webhook/cron/job/queue/script/config mentions M152 | static test |
| Existing modules unchanged | no M149–M151 production file mentions M152; no schema change, no migration | static test; the only edits to existing files are the closed file lists in three boundary tests (§8) |
| No partial result | a table above `maxRowsPerTable` (default 200 000) makes the run throw `LeadFeeReconciliationScopeTooLargeError`; unexpected errors propagate and never become an empty "clean" report | unit + integration test |

Findings never echo party data (names, tax ids, addresses): party snapshot mismatches report the *field name* only. The credit
note's free-text reason is not selected at all.

## 3. Finding codes

Each finding has: `code`, `severity`, `verification`, `subject` (`LEDGER_ENTRY` / `INVOICE` / `CREDIT_NOTE` + id), the related
`ledgerEntryId` / `invoiceId` / `creditNoteId` / `leadPurchaseId`, `documentNumber`, `field`, `expected`, `observed` (exact
2-decimal money strings, ids or ISO dates; `null` when not safe or not meaningful) and a concise `explanation`. Findings are sorted
by subject kind, subject id, code, field.

`verification` is **AUTOMATIC** when the persisted data alone proves the discrepancy and **HUMAN_REVIEW_REQUIRED** when only a
person can classify it.

### 3.1 Severity rules (technical criteria only)

| Severity | Criterion |
|---|---|
| `CRITICAL` | A monetary value (amount, currency) on a document contradicts the document it is derived from, or credits exceed what they credit. |
| `ERROR` | A database-guaranteed invariant or a reference / snapshot relationship is violated (reachable only if constraints were bypassed or data was written outside the application), or a document is internally inconsistent. |
| `WARNING` | An M150 / M151 *application* rule that the database does not enforce is violated, or a provisional-format rule is. |
| `INFO` | A state that may be legitimate pending an operational / legal decision. |

Severity and verification are a pure function of the code (`LEAD_FEE_RECONCILIATION_CATALOG`), never chosen per call site.

### 3.2 Ledger → invoice

| Code | Severity | Verification | Criterion |
|---|---|---|---|
| `LEDGER_ENTRY_WITHOUT_INVOICE` | INFO | HUMAN_REVIEW_REQUIRED | No invoice exists for the entry **and** its purchase, the purchase is `CONFIRMED`, and the entry is invoiceable under M150's *data* rules (type `LEAD_FEE_PAYMENT_SUCCEEDED`, valid amounts, `EUR`, known tax policy whose IVA verifies). |
| `LEDGER_ENTRY_AMOUNTS_INVALID` | ERROR | AUTOMATIC | net ≤ 0, IVA < 0, total ≠ net + IVA or an unparseable amount (a DB CHECK normally prevents it). |
| `INVOICE_LEDGER_ENTRY_MISSING` | ERROR | AUTOMATIC | The invoice's `ledgerEntryId` matches no ledger entry (an FK normally prevents it). |
| `INVOICE_SOURCE_REFERENCE_MISMATCH` | ERROR | AUTOMATIC | `leadPurchaseId`, `leadId` or `professionalProfileId` differs from the ledger entry (one finding per field). |
| `INVOICE_AMOUNT_MISMATCH` | CRITICAL | AUTOMATIC | `netFeeAmount`, `taxAmount` or `totalAmount` differs from the ledger value M150 copies verbatim (one finding per field; expected = ledger, observed = invoice). |
| `INVOICE_CURRENCY_MISMATCH` | CRITICAL | AUTOMATIC | Currency differs from the ledger entry. |
| `INVOICE_TAX_POLICY_MISMATCH` | ERROR | AUTOMATIC | `taxPolicyVersion` differs from the ledger entry. |
| `INVOICE_CONFIRMATION_TIME_MISMATCH` | ERROR | AUTOMATIC | `paymentConfirmedAt` differs from the ledger entry. |
| `INVOICE_AMOUNTS_INVALID` | ERROR | AUTOMATIC | Same data rule as the ledger (a DB CHECK normally prevents it). |
| `INVOICE_CURRENCY_UNSUPPORTED` | WARNING | HUMAN_REVIEW_REQUIRED | Not `EUR` (M150 issues EUR only; the invoice table does not enforce it). |
| `INVOICE_TAX_POLICY_UNSUPPORTED` | WARNING | HUMAN_REVIEW_REQUIRED | Tax-policy version not one whose rate M150 can verify. |
| `INVOICE_TAX_INCONSISTENT` | WARNING | AUTOMATIC | Stored rate or IVA differs from the stored policy version's result (verification only; nothing is recomputed or repaired). |
| `INVOICE_DUPLICATE_FOR_SOURCE` | ERROR | AUTOMATIC | More than one invoice per ledger entry or per purchase (unique indexes normally prevent it). |

### 3.3 Credit notes (policy as implemented by M151: one FULL credit per invoice)

| Code | Severity | Verification | Criterion |
|---|---|---|---|
| `CREDIT_NOTE_INVOICE_MISSING` | ERROR | AUTOMATIC | `leadFeeInvoiceId` matches no invoice (an FK normally prevents it). |
| `CREDIT_NOTE_REFERENCE_MISMATCH` | ERROR | AUTOMATIC | `originalInvoiceNumber`, `originalInvoiceIssuedAt`, `ledgerEntryId`, `leadPurchaseId`, `leadId` or `professionalProfileId` differs from the invoice. |
| `CREDIT_NOTE_CURRENCY_MISMATCH` | CRITICAL | AUTOMATIC | Currency differs from the invoice. |
| `CREDIT_NOTE_EXCEEDS_INVOICE` | CRITICAL | AUTOMATIC | A credited net / IVA / total is greater than the invoice's. |
| `CREDIT_NOTE_PARTIAL_UNDER_FULL_ONLY_POLICY` | ERROR | AUTOMATIC | A credited component is smaller than the invoice's although M151 represents FULL credits only. |
| `CREDIT_NOTE_TAX_SNAPSHOT_MISMATCH` | ERROR | AUTOMATIC | `taxRateBps` or `taxPolicyVersion` differs from the invoice. |
| `CREDIT_NOTE_PARTY_SNAPSHOT_MISMATCH` | ERROR | AUTOMATIC | An issuer / recipient snapshot field differs from the invoice (field name only; values withheld). |
| `CREDIT_NOTE_AMOUNTS_INVALID` | ERROR | AUTOMATIC | Credited amounts violate net > 0 / IVA ≥ 0 / total = net + IVA. |
| `CREDIT_NOTE_KIND_UNSUPPORTED` | ERROR | AUTOMATIC | `creditKind` is not `FULL`. |
| `CREDIT_NOTE_CURRENCY_UNSUPPORTED` | ERROR | AUTOMATIC | Not `EUR` (M151's database CHECK enforces it). |
| `CREDIT_NOTE_MULTIPLE_FOR_INVOICE` | ERROR | AUTOMATIC | More than one credit note for an invoice (the unique index normally prevents it); reported on the invoice. |
| `CREDIT_NOTE_CUMULATIVE_EXCEEDS_INVOICE` | CRITICAL | AUTOMATIC | The credit notes of one invoice together credit more net / IVA / total than was invoiced; reported on the invoice. Amounts are compared, never netted into a revenue figure. |

### 3.4 Document numbers

| Code | Severity | Verification | Criterion |
|---|---|---|---|
| `INVOICE_NUMBER_MALFORMED` | ERROR | AUTOMATIC | Not `LFI-YYYY-NNNNNN` (≥ 6 digits). |
| `INVOICE_NUMBER_DUPLICATE` | ERROR | AUTOMATIC | Same series, year **and numeric sequence** as another invoice — so zero-padding variants such as `LFI-2026-000001` / `LFI-2026-0000001`, which the unique index treats as different strings, are caught. |
| `INVOICE_NUMBER_YEAR_MISMATCH` | WARNING | HUMAN_REVIEW_REQUIRED | Year in the number ≠ year of `issuedAt` in Europe/Madrid (M150's provisional convention). |
| `CREDIT_NOTE_NUMBER_MALFORMED` | ERROR | AUTOMATIC | Not `LFC-YYYY-NNNNNN`. |
| `CREDIT_NOTE_NUMBER_DUPLICATE` | ERROR | AUTOMATIC | As for invoices. |
| `CREDIT_NOTE_NUMBER_YEAR_MISMATCH` | WARNING | HUMAN_REVIEW_REQUIRED | As for invoices. |
| `CREDIT_NOTE_ORIGINAL_NUMBER_MALFORMED` | ERROR | AUTOMATIC | The credited invoice's number snapshot is not `LFI-YYYY-NNNNNN`. |

### 3.5 Not-evaluated counters
`notEvaluated` reports, for ledger entries without an invoice that were deliberately *not* reported: purchase not `CONFIRMED`
(e.g. `REFUNDED` / `REVOKED`: M150 would not issue), purchase unknown, and entry not invoiceable by the data rules. They are counters,
not findings.

## 4. Not automated (required policy or data is missing)

| Check | Why it is not performed |
|---|---|
| Whether an uninvoiced ledger entry is *late* or a *violation* | No issuance deadline or timing rule is documented (M150 D-4, D-9). The finding is INFO and needs a person. |
| Whether M150 *could* issue the missing invoice today | Depends on operator configuration (issuer variables, `LEAD_FEE_INVOICE_POLICY_APPROVAL_REF`) and on the professional's billing-identity state (M146), neither of which is reconciled here. |
| Net revenue, or "invoice minus credit notes" | No accounting definition exists (M149 Part B 1–3, M151 D-10); nothing is netted or summed into revenue. |
| Whether a credit note was *justified*, or its relation to purchase status / refunds | M151 D-1, D-9: no rule exists. Credit notes on `REFUNDED` / `REVOKED` purchases are accepted. |
| IVA correctness beyond the stored M136 v1 policy | M150 D-5: other IVA cases are unresolved; only the stored policy's verification is repeated. |
| Numbering gaps, series legality, reset rules | M150 D-3 / M151 D-5: the `LFI` / `LFC` scheme is provisional and no gap policy exists. Only shape, duplicates and year-vs-`issuedAt` are checked. |
| Legal validity of any document (content, dates, tax point, language, retention) | Not decided anywhere; M152 asserts nothing about it. |
| Ledger ↔ Stripe / provider settlement, fees, chargebacks, refunds | Provider data is out of scope (M153 / M155). |
| Pre-M149 confirmed purchases without a ledger entry | By construction invisible to a ledger-driven check (M149 A10). |
| Ledger entries vs. their purchase snapshot | That is M149's own invariant; M152 covers ledger ↔ invoice ↔ credit note. |
| Malformed numbers, several credit notes per invoice, and other states the database itself forbids | Checked by the rules and unit tests, but PostgreSQL integration tests cannot create them (CHECKs and unique indexes stay enforced); the zero-padding duplicate and FK/trigger-bypassed rows are the representable ones. |

## 5. Code map

| Piece | File |
|---|---|
| Pure rules, catalogue, observed types, typed scope error | `src/core/domain/services/lead-fee-document-reconciliation.ts` |
| Read-only port | `src/core/domain/repositories/lead-fee-document-reconciliation-reader.ts` |
| Prisma adapter (`findMany` only, READ ONLY / REPEATABLE READ) | `src/core/infrastructure/database/prisma/repositories/prisma-lead-fee-document-reconciliation-reader.ts` |
| Use case | `src/core/application/use-cases/lead-fee-document-reconciliation/reconcile-lead-fee-documents.use-case.ts` |
| Composition root (manual DI, imported by nothing) | `src/core/application/use-cases/lead-fee-document-reconciliation/compose.ts` |

No schema change, no migration, no new dependency, no persisted result (a persisted run history would need a policy for retention
and for "resolution" that does not exist; the existing M80 pattern is tied to legacy enums).

## 6. Tests

See the final report for what was actually executed and the result of each run; this file only lists what exists.

| Layer | File |
|---|---|
| Pure rules (consistent data, every code, ineligible entries, multi-credit policy, determinism, order independence, immutability, no float, 20 000-triple dataset) | `tests/unit/core/domain/services/lead-fee-document-reconciliation-m152.test.ts` |
| Use case (report shape, summary, repeatability, error propagation, query-only port) | `tests/unit/core/application/use-cases/lead-fee-document-reconciliation/reconcile-lead-fee-documents-m152.test.ts` |
| Static boundary (read-only, no trigger, no schema change, M149–M151 untouched, documentation) | `tests/unit/prisma/lead-fee-document-reconciliation-boundary-m152.test.ts` |
| **Real PostgreSQL** (real flow reconciles clean, detection on persisted rows, zero state change incl. `xmin`, repeatability, paging, 3 000-row dataset, scope limit) | `tests/integration-db/lead-fee-document-reconciliation/lead-fee-document-reconciliation-m152.test.ts` |

Corrupt states cannot be produced through the application. The integration test creates them in the guarded test database only, one
transaction at a time, with `SET LOCAL session_replication_role = replica` (triggers and FK checks off; CHECKs and unique indexes
stay on), the technique the M151 suite already uses. Production code never does this.

## 7. Compatibility with M149–M151

No M149–M151 production file, schema, migration or behaviour changed. M149–M151 are read through their tables only; the issuance
paths, advisory locks, number allocation and append-only triggers are untouched, and a normal issuance after a reconciliation run
consumes the next number (integration-tested).

## 8. Edits to existing files

The M149, M150 and M151 static boundary tests pin *closed lists* of the files allowed to touch their tables. They were extended with
the M152 files (the reader and domain rules), exactly as M150 and M151 extended their predecessors' lists. The M152 boundary test
pins that the reader only issues `findMany` inside a READ ONLY transaction.

## 9. Unresolved legal / accounting / product decisions (NOT decided here)

1. **D-1 Issuance timing** — when a confirmed lead-fee payment must be invoiced, and therefore when "no invoice" becomes a problem.
2. **D-2 Revenue definition** — how invoices and credit notes combine into reported revenue (net of IVA? net of credits? by which date?). M152 reports no such figure.
3. **D-3 Remediation** — who reviews a finding, how a discrepancy is *resolved* (a corrective document, a data fix, an accepted exception), and where that decision is recorded. M152 never marks anything resolved.
4. **D-4 Severity ↔ urgency** — the severities are technical; whether `CRITICAL` means an operational alert or a compliance incident is undecided.
5. **D-5 Scheduling and audience** — whether, how often and by whom the check runs (admin console M157, scheduled job), who may read a report, and its retention. Nothing runs it today.
6. **D-6 Numbering policy** — gap policy, series, reset rules (M150 D-3 / M151 D-5), which also decides whether gaps should become findings.
7. **D-7 Credit-note policy** — partial credits, multiple credits per invoice, relation to refunds (M151 D-1…D-3). Today every second credit note is a finding.
8. **D-8 Provider reconciliation** — comparing documents with Stripe settlement data (M153 / M155).
9. **D-9 Pre-M149 purchases** — whether confirmed purchases without a ledger entry must be backfilled and reconciled (M149 Part B 7).

## 10. Known limitations

- The whole dataset is read into memory (paged, bounded by `maxRowsPerTable`, default 200 000 per table); a larger scope fails loudly instead of being truncated. A windowed or incremental mode would need a decision on how partial results are interpreted.
- The snapshot is point-in-time (REPEATABLE READ); documents issued after it started are not seen, and an uninvoiced entry may legitimately be invoiced a moment later.
- `LEDGER_ENTRY_WITHOUT_INVOICE` uses only data-derivable eligibility; the invoice may still be impossible for reasons outside the data (issuer or approval not configured, billing identity not VERIFIED, non-ES recipient). This is why it is INFO.
- A purchase moved to `REFUNDED` / `REVOKED` after confirmation but before invoicing is not reported; whether it should be is part of D-1 / D-7.
- A clean report means "no discrepancy found by these rules", not that the records are correct, complete or compliant. Passing tests does not make this production-ready.
