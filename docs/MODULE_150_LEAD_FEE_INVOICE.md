# Module 150 — Lead-Fee Invoice

Status: implemented on `feature/module-150/lead-fee-invoice`. Scope: LEAD_V1 only.

**This module records an invoice for a confirmed lead-fee payment. It does NOT claim that the recorded invoice is
legally compliant.** The repository contains no reviewed legal/accounting policy for LEAD_V1 invoices (see
*Unresolved decisions*). Issuance is therefore a **fail-closed** boundary: it only happens for the narrow case the
code can verify and only when an operator has supplied an explicit policy-approval reference. Nothing in the code,
the schema or this document should be read as a statement that the generated records satisfy Spanish invoicing rules.

## 1. What it does

For ONE confirmed lead purchase it records ONE immutable invoice, issued by MaestroYa to the professional, for the
lead-access fee the professional paid MaestroYa (net fee + IVA = total collected). It never invoices the customer's
job value, the lead's estimated job value, materials/labour, or the professional's service revenue — none of these is
read: the only inputs are the M149 ledger entry, the purchase's own snapshot (cross-check) and the M146 billing identity.

Not implemented (deliberately): PDF/document generation, e-mail/in-app delivery, a UI, automatic issuance, an admin
console, cancellation/correction, credit notes, refunds (see §9).

## 2. Lifecycle

```
[payment initiated / pending / failed / cancelled]  --> no ledger entry --> no invoice, ever
[M141 verified webhook: PENDING_PAYMENT -> CONFIRMED + M149 ledger entry, one transaction]
        |
        v   IssueLeadFeeInvoiceUseCase.execute(leadPurchaseId)   (trusted-internal; called by nothing today)
   1. input is a UUID                                   else INPUT
   2. M149 ledger entry exists for the purchase         else LEDGER_ENTRY_MISSING
   3. invoice already exists for that entry?            --> return it (created:false); no re-evaluation, no number consumed
   4. operator config: approval reference + issuer      else POLICY_NOT_APPROVED / ISSUER_NOT_CONFIGURED
   5. purchase is still CONFIRMED (not REFUNDED/REVOKED/…)  else PURCHASE_NOT_FOUND / PURCHASE_NOT_CONFIRMED
   6. ledger entry agrees with the purchase snapshot    else LEDGER_ENTRY_INVALID / LEDGER_PURCHASE_MISMATCH
   7. EUR; M136 policy version known; stored IVA equals that policy's result (verification, not recalculation)
                                                        else UNSUPPORTED_CURRENCY / UNSUPPORTED_TAX_POLICY / TAX_AMOUNT_INCONSISTENT
   8. M146 billing identity VERIFIED + complete, of THIS professional, taxCountry = country = ES, 5-digit postal
      code outside Las Palmas/Tenerife/Ceuta/Melilla   else BILLING_IDENTITY_NOT_READY / UNSUPPORTED_RECIPIENT_COUNTRY / UNSUPPORTED_TAX_TERRITORY
   9. repository.issue(draft) — ONE DB transaction (see §4)   else BILLING_IDENTITY_CHANGED
        |
        v
   ISSUED invoice row (immutable). There is no draft/cancelled state; a row exists only once issued.
```

Every rejection is a `LeadFeeInvoiceNotIssuableError` (`code = LEAD_FEE_INVOICE_NOT_ISSUABLE`) with a closed `reason`
and a static message. Rejections persist nothing, allocate no number, and never carry a tax id, name or address.
Unexpected errors (database, readiness read) propagate; they are never converted into an invoice or swallowed.

The use case is **trusted-internal**: `leadPurchaseId` must come from a persisted record, the result contains the
recipient's tax id and address, and it is constructed only by `use-cases/lead-fee-invoice/compose.ts`, which no
route, Server Action, webhook or job imports (static test). Payment initiation (M140), the webhook (M141) and
confirmation are unchanged and do not reference invoices.

## 3. Authoritative source of amounts

| Invoice field | Source |
|---|---|
| `netFeeAmount`, `taxAmount`, `totalAmount`, `currency`, `taxPolicyVersion`, `paymentConfirmedAt` | the persisted **M149 ledger entry**, copied verbatim as exact 2-decimal strings |
| `taxRateBps` | derived from the entry's M136 `taxPolicyVersion` (`lead-fee-tax-policy-v1` → 2100 = 21%); an unknown version is rejected |
| recipient (type, legal name, tax id, tax country, address, `billingIdentityRevision`, `billingIdentityVerifiedAt`) | frozen **M146 snapshot** (`GetProfessionalBillingReadinessUseCase`) at issuance — a copy, not a reference |
| issuer (legal name, tax id, address), `policyApprovalReference` | operator environment (below), copied at issuance |
| `issuedAt` | system clock at issuance |
| `description` | constant `"Lead access fee (LEAD_V1)"` (no customer/job data) |

Nothing is recomputed from current pricing/tax configuration. The IVA amount is only *verified* against the policy
version stored with the entry, and an inconsistent value is rejected, never "repaired". Money is `Decimal(10,2)` and
travels as decimal strings (`fixed-point-decimal`, bigint); no JS float. The purchase's own snapshot is used only as
a cross-check (ids, payment reference, amounts, currency must equal the entry).

Operator configuration (read on every issuance; **closed by default**, no fallbacks, no placeholder accepted):

| Variable | Meaning |
|---|---|
| `MAESTROYA_ISSUER_LEGAL_NAME`, `MAESTROYA_ISSUER_TAX_ID`, `MAESTROYA_ISSUER_ADDRESS` | all three required; the tax id must not be `PENDING-CIF-CONFIRMATION`. The legacy `invoicing-issuer` constants are **not** used (they silently default the legal name). |
| `LEAD_FEE_INVOICE_POLICY_APPROVAL_REF` | reference of the reviewed legal/accounting approval; stored on every invoice. Absent = issuance refused. |

## 4. Idempotency and concurrency

Layers, outermost first:

1. **Replay short-circuit** — an invoice that already exists for the entry is returned before any config/identity check.
2. **Per-entry advisory lock** — `pg_advisory_xact_lock(hashtext('lead_fee_invoice'), hashtext(<ledgerEntryId>))` at the start of the
   issuing transaction: concurrent attempts for the same entry queue; the losers see the winner's row and return it
   (`created:false`) **without allocating a number**.
3. **Identity re-check** — inside the transaction, `SELECT … FROM professional_billing_identities … FOR SHARE` must show the
   identity VERIFIED at exactly `draft.billingIdentityRevision`; a concurrent edit waits for this transaction (and the M146
   trigger would reset it afterwards). Otherwise `BILLING_IDENTITY_CHANGED`.
4. **Number allocation in the same transaction** — `allocateNextDocumentSequence(tx, "LFI", year)` (the existing atomic
   `invoice_number_counters` upsert). If the insert fails, the counter increment rolls back: no burned numbers.
5. **DB unique indexes** — `invoiceNumber`, `ledgerEntryId`, `leadPurchaseId`: the final arbiter (a `P2002` race resolves to the winner's row).
6. **INSERT trigger** — see §5.

Numbering: series `LFI`, format `LFI-YYYY-NNNNNN`, sequence per (series, year) in Spanish civil time (`Europe/Madrid`).
Distinct from legacy `INV-` / `CN-`; legacy counters are never touched. **The series/format is provisional (decision D-3).**

## 5. Schema and migration

`prisma/migrations/20261014000000_add_module_150_lead_fee_invoice/migration.sql` — additive only: one table
`lead_fee_invoices` (Prisma `LeadFeeInvoice`), reusing the existing `BillingEntityType` enum; no existing table, column, row,
trigger or enum is altered or backfilled. The only schema.prisma change to an existing model is the **relation field**
`LeadFeeLedgerEntry.invoice` (no database column; the ledger table is unchanged).

* Unique: `invoiceNumber`, `ledgerEntryId`, `leadPurchaseId`. Indexes on `(professionalProfileId, issuedAt)` and `issuedAt`.
* FK `ledgerEntryId → lead_fee_ledger_entries(id)` **ON DELETE RESTRICT**. No FK to the mutable billing identity (the snapshot is
  stored in the row, so later profile changes cannot alter an invoice and profile erasure/cascade is not coupled to it).
  `leadId` / `professionalProfileId` / `leadPurchaseId` are denormalised from the entry (verified by the trigger).
* CHECKs: net > 0, tax ≥ 0, total = net + tax, rate 0..10000 bps; number shape `^LFI-\d{4}-\d{6,}$`; currency / country code shapes;
  mandatory issuer/recipient/description/approval text non-blank; `issuerTaxId <> 'PENDING-CIF-CONFIRMATION'`; revision ≥ 1.
* `BEFORE INSERT` trigger `lead_fee_invoices_validate_insert`: the row must match the ledger entry (type, purchase, lead,
  professional, net, tax, total, currency, tax policy version, confirmation time), the purchase must be `CONFIRMED`, and the billing
  identity must be `VERIFIED` at the snapshotted revision/verification time (row-locked `FOR SHARE`).
* `BEFORE UPDATE OR DELETE` trigger: the invoice is append-only (TRUNCATE is unaffected, as for the ledger/tests).
* Rollback (only if no invoice must be kept): drop the table and the two functions; optionally delete the `LFI` counter rows.

M149 stays append-only and writer-restricted: the invoice adapter never references the ledger accessor/table
(the ledger is read through the existing `LeadFeeRevenueLedgerRepository`), and a static test pins this.

## 6. Code map

| Piece | File |
|---|---|
| Pure rules, typed rejection, config resolver, number format | `src/core/domain/services/lead-fee-invoice.ts` |
| Repository port | `src/core/domain/repositories/lead-fee-invoice-repository.ts` |
| Prisma adapter | `src/core/infrastructure/database/prisma/repositories/prisma-lead-fee-invoice-repository.ts` |
| Use case | `src/core/application/use-cases/lead-fee-invoice/issue-lead-fee-invoice.use-case.ts` |
| Composition root (manual DI) | `src/core/application/use-cases/lead-fee-invoice/compose.ts` |
| Migration / model | `prisma/migrations/20261014000000_…/migration.sql`, `prisma/schema.prisma` |

No legacy invoicing code (`Invoice`, `CreditNote`, self-billing, `invoice-document`, lifecycle, the INV/CN allocators) is reused or
modified; only the shared atomic counter helper `allocateNextDocumentSequence` and the pure `isPlaceholderIssuerTaxId` predicate.
The legacy model is job-based self-billing (professional → MaestroYa for a Job, with commission/IRPF fields), the opposite direction
and a different tax object, so it is not suitable for LEAD_V1.

## 7. Compatibility with M146–M149

* **M146** — consumed through `GetProfessionalBillingReadinessUseCase` only (its `snapshot` is non-null only when `billingReady`).
  The M146 boundary test's closed list of files that may mention the billing identity was extended with the five M150 files (as M147
  did) and its "no lead adapter reads the billing table" rule excludes the invoice adapter; no M146 behaviour changed.
* **M147 / M148** — untouched. Eligibility gates *starting* a purchase; invoicing requires only a verified billing identity at issuance
  (a later suspension of the professional does not void an invoice for a payment already collected). Onboarding is unrelated.
* **M149** — read-only consumer; the ledger table, adapter and trigger are unchanged.
* **M140 / M141** — unchanged; confirmation does not create invoices.

## 8. Tests

See the final report for what was actually executed and the result of each run; this file only lists what exists.

| Layer | File |
|---|---|
| Domain rules (decimals, every rejection reason, config, numbering/year) | `tests/unit/core/domain/services/lead-fee-invoice-m150.test.ts` |
| Use case (valid, no entry, unconfirmed, billing states, tax scope, replay, snapshot stability, concurrent calls, rollback) | `tests/unit/core/application/use-cases/lead-fee-invoice/issue-lead-fee-invoice-m150.test.ts` |
| Prisma adapter call contract (mocked client — **not** proof of DB behaviour) | `tests/unit/core/infrastructure/database/prisma/repositories/prisma-lead-fee-invoice-m150.test.ts` |
| Static boundary (writers, legacy isolation, no automatic trigger, M146/M147/M149, migration additivity) | `tests/unit/prisma/lead-fee-invoice-boundary-m150.test.ts` |
| **Real PostgreSQL** (constraints, triggers, concurrency, rollback, snapshot, isolation, M146/M149 regression) | `tests/integration-db/lead-fee-invoice/lead-fee-invoice-m150.test.ts` |
| Fixtures / in-memory fake | `tests/test-utils/lead-fee-invoice-fixtures.ts`, `tests/test-utils/fake-lead-fee-invoice-repository.ts` |

## 9. Unresolved legal / accounting / product decisions (NOT decided here)

1. **D-1 Issuer** — the legal entity that may issue these invoices, its real legal name, CIF and address. The repository only has a placeholder
   (`PENDING-CIF-CONFIRMATION`) and no address; M150 refuses to issue until all three are configured.
2. **D-2 Mandatory invoice content** under Spanish rules (RD 1619/2012) — whether the stored fields (issuer/recipient identity, address,
   description, net/rate/IVA/total, date) are sufficient; the description wording and language; simplified vs full invoice.
3. **D-3 Numbering** — series, prefix, format, per-year reset, whether a separate series is required, gap policy. `LFI-YYYY-NNNNNN` is provisional.
4. **D-4 Issue date and tax point (devengo)** — `issuedAt` (system clock) and `paymentConfirmedAt` are stored; which is the invoice date and which the
   operation date/tax point is undecided, as is when the invoice must be issued relative to payment/access.
5. **D-5 IVA validity** — the stored amount is the M136 21% pilot policy. Unresolved for: professionals outside Spain, EU intra-community/reverse-charge,
   exempt cases, individuals vs companies vs non-business, special regimes, Canarias/Ceuta/Melilla (excluded here by a **postal-code heuristic**, not a
   legal determination of the professional's tax status), and whether a billing identity verified only by an admin review (no VIES/registry) suffices.
6. **D-6 Operating model** — whether the platform may issue this invoice under its current model (cf. MODULE_115 L-12), and the relation to the
   separate legacy self-billing authorisation.
7. **D-7 Corrections / cancellation / refunds / credit notes** — none exist (M151/M153). An issued invoice is immutable; if the purchase is later
   REFUNDED/REVOKED the invoice remains and needs a corrective document.
8. **D-8 Document** — PDF/format, storage, delivery (e-mail/in-app), language, retention period and its technical enforcement, GDPR erasure interplay
   (the invoice stores the recipient's data and is not cascade-deleted).
9. **D-9 Trigger and authority** — who/what issues invoices (automatic after confirmation, on request, admin console M157), and who may read them.
10. **D-10 Approval mechanism** — `LEAD_FEE_INVOICE_POLICY_APPROVAL_REF` is an operator-set gate that records *a reference*; it does not verify that a
    review took place. A real approval workflow is a product/legal decision.
11. **D-11 Pre-M149 purchases** — confirmed purchases without a ledger entry (M149 A10) cannot be invoiced until their entry exists.

## 10. Deferred to later modules

M151 credit notes/corrections · M152 reconciliation of invoices against the ledger/provider · M153 refund execution · M154 quality claims ·
M155 chargebacks/access revocation · M156 fraud controls · M157 admin console (including any manual issuance UI and billing-identity review UI) ·
M158 retention/GDPR policy. Also deferred: PDF generation and delivery, automatic/batch issuance, a read model/UI for invoices.
