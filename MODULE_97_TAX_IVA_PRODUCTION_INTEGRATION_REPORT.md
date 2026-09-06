# Module 97 — Tax & IVA Production Integration

Status: **READY WITH CONDITIONS**

> **Correction pass update ("Correct Comunidad de Propietarios IVA Treatment"):** see
> §24 for the dedicated writeup of everything changed in this follow-up pass
> (float-safe materials-ratio boundary, fuller tax snapshot, expanded test coverage).
> Every other section below reflects the original implementation pass and is still
> accurate except where §24 says otherwise.

> **Final pass update ("Invoice Tax Snapshot Integration"):** see §25 for the fix that
> closes the one remaining functional gap §21/§24 both flagged — Invoice generation now
> consumes the Quote's own authoritative tax snapshot instead of independently
> re-deciding the general IVA rate. Sections 1-24 are otherwise unchanged and still
> accurate except where §25 says otherwise.

## 1. Executive summary

Module 97 connects MaestroYa's existing Spain IVA tax engine (Modules 36/78) to the
real Quote lifecycle, and implements the Comunidad de Propietarios 10% IVA rule as a
conditional policy rather than an unconditional `customerType === COMMUNITY ? 10% : 21%`
branch. It adds `CustomerType`/`QuoteOperationType` classification, a pure
`classifyCommunityIvaRate` domain policy, a `computeQuoteTaxSnapshot` service that reuses
the existing tax engine, and wires the snapshot into `CreateQuoteUseCase` so every new
Quote persists its own authoritative, immutable tax snapshot.

During the read-only audit this module also **surfaced a pre-existing financial
inconsistency, not introduced by this change**: `Payment.amount` (what Stripe actually
charges) is the *net* sum of Quote items, while the `CUSTOMER_RECEIPT` invoice
(Module 85) shows `customerGrossTotal` (net + IVA) as the amount "the customer paid."
These two figures diverge today for any Job whose tax engine runs with a non-zero rate.
Fixing that — i.e., changing what Stripe actually charges — is a live money-movement
change with real business/legal/accounting consequences (Stripe amounts, commission
timing, existing revenue reconciliation), so it is deliberately **not** done in this
pass. See §9 and §21 "Remaining risks."

## 2. Existing Module 36/78 architecture discovered (Phase 1 audit)

**A. Where is the current tax engine?**
`src/core/domain/services/tax-calculator.ts` (country-agnostic contract),
`spain-iva-calculator.ts` (Spain's 4 official rates: 21/10/4/0%), `tax-engine.ts`
(`calculatePriceBreakdown`, combines tax + Module 64 commission), and
`maestroya-tax-calculation-service.ts` (`calculateMaestroYaTaxBreakdown`,
`calculateTaxReversal` — the Module 78 layer that also derives the professional's own
self-billing IVA and IRPF withholding).

**B. What inputs does it currently use?**
`labourAmount`, `professionalMaterialsAmount`, `customerMaterialsAmount` (always 0 today
— see finding below), `countryCode` ("ES" only), an optional `taxRateBps` override, and
commission rates. It never took a customer classification or an operation-type input —
that's what Phases 3-4 add.

**C. Did it distinguish customer type / service type / materials / renovation /
maintenance / construction / residential property?**
No. None of these concepts existed anywhere in the schema or domain layer before this
module. `CalculateJobTaxBreakdownUseCase` only distinguished LABOR vs MATERIALS
QuoteItem categories (for the existing Scenario A/B materials-procurement split), never
a legal operation classification.

**D. Where was the tax result persisted?**
Only on `Invoice`/`CreditNote` (Module 79/85's `taxableBase`, `vatRateBps`, `vatAmount`,
`commissionBase`, `commissionAmount`, `irpfWithholdingRateBps/Amount`, `totalAmount`) —
computed once, at invoice-draft creation, from `CalculateJobTaxBreakdownUseCase`.
**`Quote` and `Payment` had no tax fields at all.**

**E. Was IVA present in Quote / Payment / Invoice / Transaction / Commission?**
Invoice: yes (full breakdown). CreditNote: yes (reversal breakdown). Quote: **no**.
Payment: **no**. Transaction (ledger): no explicit IVA columns — it only records signed
`amount` entries keyed by type (commission/payout/refund), which is out of this
module's minimum-persistence scope per Phase 10 (see §10).

**F. Which flows calculate tax but never persist/use it?**
`CalculateJobTaxBreakdownUseCase` computes a full breakdown live, on every call, from
Job → Quote → QuoteItems — it is called by `CreateProfessionalInvoiceDraftUseCase` and
`CreateCustomerReceiptDraftUseCase` at invoice-draft time, but **never by
`CreateQuoteUseCase`, `UpdateQuoteUseCase`, or `InitiateQuotePaymentUseCase`.** So the
Quote a customer accepts, and the Payment/Stripe charge collected from them, never see
IVA at all — only the invoice generated *after the job completes* does. This is the
exact gap Phase 6/7 asked this module to close for the Quote side.

**G. Smallest change to connect the engine to production flows?**
Add a persisted, Quote-level tax snapshot (Phase 5/6) computed once at quote creation
from the existing `SpainIvaCalculator` plus a new, additive classification policy —
without touching `Payment.amount`'s existing meaning, `Invoice`'s existing schema, or
any existing commission math. That is what this module implements.

## 3. Changes implemented

### Domain (Phases 2-4)
- `src/core/domain/value-objects/customer-type.ts` — `CustomerTypeValue`:
  `PRIVATE_CUSTOMER | COMMUNITY_OF_OWNERS | COMPANY`. Default `PRIVATE_CUSTOMER`.
- `src/core/domain/value-objects/quote-operation-type.ts` — `QuoteOperationTypeValue`:
  `RENOVATION_OR_REPAIR | MAINTENANCE | OTHER`.
- `src/core/domain/services/spain-community-iva-classification-policy.ts` —
  `classifyCommunityIvaRate()`: the Phase 4 policy. **Not** `COMMUNITY ? 10% : 21%`.
  Decision table (full doc comments in the file):
  1. `customerType !== COMMUNITY_OF_OWNERS` → general 21% (`ES_STANDARD_GENERAL`).
     Scope note: this module's community-only remit means PRIVATE_CUSTOMER/COMPANY
     never get the reduced rate here even though Spanish law may separately allow it
     for private-dwelling renovations generally — flagged as future work, not silently
     implemented.
  2. Community, but `operationType`/`isResidentialProperty` not supplied → general 21%,
     `ES_COMMUNITY_INSUFFICIENT_DATA_DEFAULTED_GENERAL`, `requiresLegalConfirmation: true`.
     Never guesses a reduced rate from missing data.
  3. Community, `operationType` is `MAINTENANCE`/`OTHER` (not qualifying) → general 21%,
     `ES_COMMUNITY_NON_QUALIFYING_OPERATION_GENERAL`.
  4. Community, qualifying renovation, non-residential property → general 21%,
     `ES_COMMUNITY_NON_RESIDENTIAL_GENERAL`.
  5. Community, qualifying renovation, residential, but materials ratio exceeds
     `COMMUNITY_REDUCED_RATE_MAX_MATERIALS_RATIO` (0.40, documented as requiring asesor
     confirmation) → general 21%, `ES_COMMUNITY_MATERIAL_HEAVY_GENERAL`,
     `requiresLegalConfirmation: true`.
  6. Community, qualifying renovation, residential, materials within threshold →
     reduced 10%, `ES_COMMUNITY_QUALIFYING_RENOVATION_REDUCED`,
     `requiresLegalConfirmation: true` (every reduced-rate outcome is flagged — see §20).

### Application (Phases 5-6)
- `src/core/application/services/quote-tax-snapshot.ts` — `computeQuoteTaxSnapshot()`:
  the single place a Quote's tax snapshot is computed. Reuses `calculateQuoteTotal`,
  `classifyCommunityIvaRate`, and `SPAIN_IVA_CALCULATOR` — never re-derives arithmetic.
  Returns `{ taxableBase, vatRateBps, vatAmount, grossTotalAmount, taxClassificationCode,
  taxRequiresLegalConfirmation, taxCalculationVersion, taxCalculatedAt }`, where
  `grossTotalAmount = taxableBase + vatAmount` exactly (Phase 6's "total = net + tax").
- `CreateQuoteUseCase` now resolves the requesting customer's `CustomerProfile.customerType`
  (server-side, via `CustomerProfileRepository.findByUserId(request.customerUserId)` —
  never trusted from the client) and calls `computeQuoteTaxSnapshot` before persisting
  the Quote. The snapshot is written once and never recalculated on read.

### Database (Phase 13)
New migration `prisma/migrations/20260918000000_add_module_97_tax_classification/`:
- `CustomerType` enum + `customer_profiles.customerType` (`NOT NULL DEFAULT
  'PRIVATE_CUSTOMER'` — every existing row keeps behaving exactly as before).
- `QuoteOperationType` enum + `quotes.operationType` / `quotes.isResidentialProperty`
  (both nullable — explicit, never-inferred inputs).
- `quotes.taxableBase / vatRateBps / vatAmount / grossTotalAmount /
  taxClassificationCode / taxRequiresLegalConfirmation (NOT NULL DEFAULT false) /
  taxCalculationVersion / taxCalculatedAt` — the persisted snapshot, all nullable except
  the boolean flag (which is only ever false-by-default for rows this module never
  touched).

No existing table/column was renamed, dropped, or reinterpreted. `Quote.totalAmount`
keeps its exact pre-existing meaning (net sum of items) — see §9.

### API/DTO (Phase 14)
`quote.dto.ts` gained optional `operationType`/`isResidentialProperty` fields on
`createQuoteSchema`/`updateQuoteSchema` — professional-supplied, optional, never
required, matching the "insufficient data is a valid state" policy design.

### Repository plumbing
`CustomerProfileRepository`/`QuoteRepository` interfaces and their Prisma
implementations were extended additively. A `NullCustomerProfileRepository` was added
so ~40 pre-existing direct-construction test call sites of `CreateQuoteUseCase` (which
never knew this new dependency existed) keep compiling and behave exactly as before
(defaulting to `PRIVATE_CUSTOMER`, i.e. today's implicit behavior) — the constructor
change is purely additive/optional, never a breaking reorder for any *positional* caller.

## 4. Tax/IVA rules implemented

General 21% (default), reduced 10% (Community qualifying renovation only, per the
decision table above), and the existing 4%/0% rates remain available via
`SpainIvaCalculator` (unchanged, not touched by this module) for any future explicit
override.

## 5. Community of Owners treatment

Implemented exactly as Phase 3/4 require: `COMMUNITY_OF_OWNERS` is
necessary-but-not-sufficient. See the 6-branch decision table in §3. Verified by 13
unit tests in `tests/unit/core/domain/spain-community-iva-classification-policy.test.ts`.

## 6. 10% IVA rule and its exact conditions

`customerType === COMMUNITY_OF_OWNERS` **and** `operationType === RENOVATION_OR_REPAIR`
**and** `isResidentialProperty === true` **and** `materialsAmount / taxableAmount <= 0.40`.
The 0.40 threshold and the "qualifying renovation/repair" boundary are this codebase's
best-effort encoding of Ley 37/1992 art. 91.Uno.2.10º's publicly known shape — **not** a
substitute for asesor fiscal sign-off (see §20). Every branch that reaches the reduced
rate sets `requiresLegalConfirmation: true`.

## 7. Rules intentionally NOT assumed

- No blanket `COMMUNITY → 10%`.
- No reduced-rate eligibility for `PRIVATE_CUSTOMER`/`COMPANY` renovation work (legally
  plausible under the same article, but out of this module's explicit Phase 4 scope —
  flagged as follow-up, not implemented).
- No invented materials-ratio precedent beyond the widely-cited 40% figure — encoded as
  a named, documented constant specifically so it's auditable and swappable pending
  asesor confirmation.
- No self-billing/contractual legal rules (Module 98's remit, untouched).
- No Modelo 036 verification (Module 98's remit) — this module's classification inputs
  (`CustomerType`) are structured so Module 98 can later feed verified data into the
  same fields without a schema change.

## 8. Quote integration

`CreateQuoteUseCase` computes and persists the full snapshot at creation. `Quote`
exposes: net amount (`taxableBase`, and the pre-existing `totalAmount` — same value),
IVA rate (`vatRateBps`), IVA amount (`vatAmount`), and gross/total (`grossTotalAmount =
taxableBase + vatAmount`). The snapshot is written once, at creation, and is never
recalculated on read — a later change to the classification policy or tax rates cannot
mutate an already-quoted price.

**Known limitation (documented, not fixed in this pass):** `UpdateQuoteUseCase` (editing
an already-submitted quote) does **not** recompute the tax snapshot when items change —
it keeps the original snapshot from creation, which can go stale relative to the edited
`totalAmount`. This is inert today (nothing downstream reads `Quote.grossTotalAmount`
yet — see §9), but should be fixed before anything consumes these fields for edited
quotes. Flagged as a remaining risk, §21.

## 9. Payment integration — **not done in this pass, by design**

Per Phase 7, `Payment.amount` should ultimately equal the authoritative Quote total. This
module deliberately does **not** cut `Payment.amount`/Stripe's charge over to
`Quote.grossTotalAmount`, for two reasons:
1. It is a live money-movement change — it would raise what customers are actually
   charged by the tax amount for every future Job, with direct Stripe/revenue/commission
   timing consequences that need explicit product/finance sign-off, not an automated
   pass.
2. It would need to resolve the pre-existing discrepancy found in the audit (§1): today,
   `CUSTOMER_RECEIPT.totalAmount` already shows a gross (net+IVA) figure while
   `Payment.amount`/Stripe only ever collected the net figure — i.e. the receipt has been
   silently overstating what the customer paid since Module 85 shipped. Deciding how to
   resolve that (raise future quoted/charged prices to gross, or treat existing quoted
   prices as already IVA-inclusive and back out the net) is a business decision, not a
   technical one, and I did not want to guess at it inside a financial system.

`Quote.totalAmount`/`Payment.amount` therefore keep their exact current behavior and
value in this pass; `Quote.grossTotalAmount` is new, additive, persisted, and correct,
but not yet read by anything downstream. This is the single biggest open item — see §21.

## 10. Commission interaction

Unchanged. `calculateQuoteTotal`/commission math were not touched. The new
`computeQuoteTaxSnapshot` never affects `Commission.rateBps`/`Commission.amount` —
commission continues to be calculated exactly as Module 64 always did, on the net
labour+materials base, independent of this module's IVA classification.

## 11. Invoice/CreditNote integration

Unchanged — Invoice/CreditNote already had full tax fields (Module 79/85) and already
call `CalculateJobTaxBreakdownUseCase` at draft time. This module does not touch that
path. A natural Phase 2 follow-up (not done here) would be to make invoice creation
prefer the Quote's persisted classification/`operationType`/`isResidentialProperty` over
recomputing from scratch with no classification input at all — today,
`CalculateJobTaxBreakdownUseCase` still always resolves the *general* rate (it never
reads `Quote.operationType`/`customerType`), so a Community-qualifying Quote's invoice
would currently still be taxed at 21%, not 10%. **This is a real gap**: the Module 97
snapshot exists on Quote but Invoice generation doesn't yet consume it. Flagged as a
remaining risk, §21.

## 12. Refund/dispute integration

Untouched — `calculateTaxReversal` (Module 78) already handles proportional refund tax
reversal independent of classification and continues to work exactly as before, on
whatever `vatRateBps` the invoice was actually issued at.

## 13. Database/schema changes

See §3 "Database." Purely additive; no RLS changes needed (new columns on
already-RLS-enabled tables, no new tables).

## 14. Migrations

`prisma/migrations/20260918000000_add_module_97_tax_classification/migration.sql` —
hand-authored (same standing limitation as every prior migration in this repo: no
Postgres/Prisma schema-engine binary reachable from this sandbox to run `prisma migrate
dev` and generate this file from a live diff — see any prior migration's own comment
header for the same precedent). Not applied to any database by this session.

## 15. Security review

- `customerType`, `operationType`, `isResidentialProperty` are only ever read
  server-side from `CustomerProfileRepository`/the authenticated request's own DTO
  input — never trusted as a pre-computed rate.
- No client input can set `vatRateBps`/`vatAmount`/`taxClassificationCode` directly —
  they only ever come out of `computeQuoteTaxSnapshot`'s own calculation.
- No new admin/authorization surface was added; no existing authorization check was
  weakened. `CreateQuoteUseCase`'s existing ownership/verification checks are untouched.
- No IDOR: the customer profile lookup is keyed off the server-resolved
  `request.customerUserId` from the already-validated `ServiceRequest`, not any
  request-supplied id.

## 16. GDPR review

No new PII field was added. `CustomerProfile.customerType` is a coarse tax
classification (private/community/company), not personal data requiring erasure
treatment beyond what `CustomerProfileRepository.eraseForUser` already does (unaffected
by this change). `Quote.operationType`/`isResidentialProperty` describe the job, not the
person. No change to retention/anonymization behavior was needed or made.

## 17. Tests added

- `tests/unit/core/domain/spain-community-iva-classification-policy.test.ts` — 13 tests
  covering the Phase 16 "Tax engine" list items 1-6, 8-10 (private/community/company,
  qualifying/non-qualifying/material-heavy, missing-data, zero-amount, negative-amount
  rejection, determinism).
- `tests/unit/core/application/services/quote-tax-snapshot.test.ts` — 5 tests covering
  "Quote" list items 11-13 and "Financial invariants" item 24 (snapshot persists in
  full, total = net + tax exactly, independent/non-mutating calls, no rounding drift,
  injectable deterministic timestamp).
- Updated 12 existing test/fake files to satisfy the now-required
  `CustomerProfileRecord.customerType`/`QuoteRecord` tax-snapshot fields (see §22).

Not added in this pass (flagged, not silently skipped): Quote-level integration tests
against a real Job→Payment→Commission→Invoice→Refund chain with the classification
wired all the way through (blocked on §11/§9 above being resolved first — testing an
integration that doesn't fully exist yet would either be vacuous or require faking the
missing wiring), and real-PostgreSQL constraint tests for the new migration (blocked on
§18 below).

## 18. Tests executed and exact results

Executed via `npx vitest run <paths>` inside the connected repo (in-memory-fake-backed
unit/integration tests only — no live Postgres in this sandbox, see §21):

- `tests/unit/core/domain/spain-community-iva-classification-policy.test.ts` — **13/13 passed**
- `tests/unit/core/application/services/quote-tax-snapshot.test.ts` — **5/5 passed**
- `tests/unit/core/domain/{spain-iva-calculator,tax-calculator,tax-engine,maestroya-tax-calculation-service}.test.ts`
  (pre-existing Module 36/78 tests, regression check) — **75/75 passed**
- `tests/unit/core/application/use-cases/{invoicing,financial,payments}/**` (pre-existing,
  regression check for the repository/DTO changes) — **115/115 passed**
- `tests/integration/quotes/quote-flows.test.ts` + `tests/integration/materials/materials-procurement-flow.test.ts`
  (pre-existing, exercise `CreateQuoteUseCase` end-to-end through fakes) — **56/56 passed**
  (one unrelated `PrismaClientInitializationError` unhandled-rejection warning appeared
  in the runner output — caused by the sandbox's Prisma Client being generated for
  darwin-arm64 while this shell is linux-arm64, a pre-existing environment fact
  unrelated to any code path this module touches; it did not fail or flake any test)

**Total: 264/264 executed tests passed. Zero regressions.**

Not executed — **BLOCKED** (environment, not code):
- `npm test` / full suite (`npm run test:unit`/`vitest run tests/unit` in full) — each
  attempt exceeded this session's 120s command budget; only the targeted subsets above
  were run to completion. Nothing observed suggests the untouched remainder would fail.
- `npm run test:integration:db` / any real-Postgres test — **BLOCKED**, no reachable
  Postgres test database from this sandbox.
- `npm run db:migrate:test` — **BLOCKED**, same reason; also `npx prisma generate` /
  `npx prisma validate` are blocked (see §19) since they need a schema-engine binary
  this sandbox's network egress cannot fetch for `linux-arm64`.

## 19. Verification commands and results

- `npx tsc --noEmit` — **0 errors outside the two files below.** Two files show errors
  caused solely by the Prisma Client not having been regenerated (see below), not by any
  logic error:
  - `prisma-customer-profile-repository.ts` (`customerType` unknown to the stale
    `CustomerProfileSelect` type)
  - `prisma-quote-repository.ts` (`operationType` and 8 other new fields unknown to the
    stale `PrismaQuoteRow`/`QuoteCreateInput` types)

  **BLOCKED, not FAIL**: `npx prisma generate` cannot run in this sandbox —
  `Error: Failed to fetch the engine file ... linux-arm64-openssl-3.0.x ... 403
  Forbidden` (this sandbox's shell is `linux-arm64`; only the `darwin-arm64` engine is
  cached locally, and network egress to `binaries.prisma.sh` is blocked). **Run `npx
  prisma generate` locally on your Mac and re-run `npx tsc --noEmit` — I expect those
  two files' remaining errors to disappear once the client reflects the new schema; I
  have not been able to confirm this myself.**
- `npx eslint <every file this module touched>` — **0 errors, 0 warnings.**
- `git diff --check` — **exit 0, no whitespace errors.**
- `npx prisma validate` — **BLOCKED**, same schema-engine fetch failure as above.

## 20. Legal/tax assumptions requiring asesor/abogado confirmation

Every item below is also encoded as `requiresLegalConfirmation: true` at the specific
Quote it applies to, never left only as a comment:
1. The exact legal definition of "qualifying renovation/repair" work under Ley 37/1992
   art. 91.Uno.2.10º, as opposed to ordinary maintenance.
2. The 40% materials-to-total-consideration threshold (`COMMUNITY_REDUCED_RATE_MAX_MATERIALS_RATIO`)
   — this codebase's best-effort encoding, not a verified legal figure.
3. What "residential property use" means precisely for a Comunidad de Propietarios
   (common areas of a building where units are dwellings? A specific ownership-title
   test?) — currently a bare boolean the professional/customer declares.
4. Whether MaestroYa, as marketplace intermediary, has any obligation to verify the
   `isResidentialProperty`/`operationType` declaration before relying on it for a real
   invoice.
5. Every item already listed by the Module 78 report as still open (IRPF withholding
   policy, professional self-billing tax treatment) — unaffected by, and not
   re-litigated by, this module.
6. Whether `PRIVATE_CUSTOMER`/`COMPANY` customers should also be evaluated for the same
   reduced-rate renovation treatment (deliberately out of scope here — see §7).

## 21. Remaining risks

1. **Payment/Invoice tax-figure mismatch (pre-existing, surfaced by this audit, not yet
   fixed)** — `Payment.amount` (net) vs. `CUSTOMER_RECEIPT.totalAmount` (gross) diverge
   whenever IVA is non-zero. Needs a product/finance decision (§9) before any code
   change.
2. **Invoice generation doesn't yet consume the Quote's classification** —
   `CalculateJobTaxBreakdownUseCase` still always resolves the general rate; a
   Community-qualifying Quote's eventual invoice is not yet taxed at the reduced rate
   it was quoted at (§11).
3. **`UpdateQuoteUseCase` doesn't recompute the snapshot on edit** (§8) — inert today,
   but a correctness bug waiting to happen once something reads `grossTotalAmount` for
   an edited quote.
4. **Prisma Client not regenerated** — this sandbox cannot run `prisma generate`; two
   files will show type errors until you run it locally and confirm they clear (§19).
5. **No real-Postgres verification of the migration** — the SQL was hand-written,
   following this repo's own established precedent for every prior migration, but has
   not been applied or exercised against a live database from this session.
6. The reduced-rate decision table's specific thresholds are unconfirmed by counsel
   (§20) — every such Quote is flagged, but flagged is not the same as legally settled.

## 22. Files changed

**New:**
- `prisma/migrations/20260918000000_add_module_97_tax_classification/migration.sql`
- `src/core/domain/value-objects/customer-type.ts`
- `src/core/domain/value-objects/quote-operation-type.ts`
- `src/core/domain/services/spain-community-iva-classification-policy.ts`
- `src/core/application/services/quote-tax-snapshot.ts`
- `tests/unit/core/domain/spain-community-iva-classification-policy.test.ts`
- `tests/unit/core/application/services/quote-tax-snapshot.test.ts`
- `MODULE_97_TAX_IVA_PRODUCTION_INTEGRATION_REPORT.md` (this file)

**Modified:**
- `prisma/schema.prisma`
- `src/core/application/dto/quote.dto.ts`
- `src/core/application/use-cases/quotes/compose.ts`
- `src/core/application/use-cases/quotes/create-quote.use-case.ts`
- `src/core/domain/repositories/customer-profile-repository.ts`
- `src/core/domain/repositories/quote-repository.ts`
- `src/core/infrastructure/database/prisma/repositories/prisma-customer-profile-repository.ts`
- `src/core/infrastructure/database/prisma/repositories/prisma-quote-repository.ts`
- `tests/integration/analytics/fakes.ts`
- `tests/integration/gdpr/fakes.ts`
- `tests/integration/materials/materials-procurement-flow.test.ts`
- `tests/integration/quotes/fakes.ts`
- `tests/integration/quotes/quote-flows.test.ts`
- `tests/integration/service-request/fakes.ts`
- `tests/unit/core/application/use-cases/financial/calculate-job-tax-breakdown.use-case.test.ts`
- `tests/unit/core/application/use-cases/invoicing/invoicing-use-cases.test.ts`
- `tests/unit/core/application/use-cases/invoicing/module-85-activation.test.ts`
- `tests/unit/core/application/use-cases/payments/fakes.ts`
- `tests/unit/core/application/use-cases/payments/initiate-quote-payment.use-case.test.ts`

No file was deleted. No unrelated file was touched. No git staging/commit/push was
performed (per operating rules) — a stale, empty `.git/index.lock` was left behind by a
read-only `git diff --check` call in this sandbox; this session does not have
permission to delete it. **Please run `rm .git/index.lock` from your repo root before
your next `git add`/`git commit`** (it is a 0-byte leftover, always safe to remove when
no git process is actually running).

## 23. Definition of Done checklist

- [x] Existing Module 36 tax engine was audited before implementation.
- [x] No duplicate tax engine was created.
- [x] Tax calculation is connected to the real Quote lifecycle.
- [x] Quote stores an authoritative tax snapshot.
- [x] Quote total (`grossTotalAmount`) = net (`taxableBase`) + tax (`vatAmount`).
- [ ] Payment uses the authoritative Quote total — **deliberately not done, see §9/§21.**
- [x] Community of Owners is explicitly supported.
- [x] 10% IVA is implemented only for qualifying cases.
- [x] Community is NOT hardcoded to always use 10%.
- [x] Non-qualifying Community operations use the appropriate alternative (general) rate.
- [x] Material-heavy cases are explicitly handled (safely defaulted to general + flagged).
- [x] Tax calculations use `Decimal` at the database layer (`@db.Decimal(10,2)`); the
      calculation layer itself follows this codebase's pre-existing, deliberate
      convention of plain rounded-to-cents `number`s (see `money.ts`/`tax-calculator.ts`
      doc comments) — this module did not introduce floating-point arithmetic where the
      existing engine didn't already use it, and did not attempt an unrelated,
      out-of-scope migration of the whole tax engine to an arbitrary-precision library.
- [x] Rounding is deterministic (`roundToCents` at every step, verified by a dedicated test).
- [ ] Invoice/CreditNote receives authoritative tax information **from the Quote's own
      classification** — Invoice already receives *a* tax breakdown (pre-existing), but
      not yet the Quote's persisted classification — see §11, flagged as a risk.
- [x] Refunds/chargebacks preserve tax correctness (untouched, pre-existing, unaffected).
- [x] Historical financial records are not silently mutated.
- [x] Commission economics from previous modules are not unintentionally changed.
- [x] No client-controlled IVA manipulation is possible.
- [x] No IDOR introduced.
- [x] GDPR behavior is compatible with financial retention (no change needed).
- [ ] Real PostgreSQL integration tests — **BLOCKED**, no reachable database (§18).
- [x] No fake accounting or fake tax calculations were introduced.
- [~] `tsc` passes — passes except for two files blocked on a `prisma generate` this
      sandbox cannot run (§19); please re-verify locally.
- [x] `lint` passes.
- [x] `git diff --check` passes.
- [x] Report created.
- [x] No git add/commit/push performed.

## 24. Comunidad de Propietarios IVA Classification (Correction Pass)

This section documents the narrow follow-up pass "Correct Comunidad de Propietarios
IVA Treatment." Per that task's own scope, this pass did **not** redesign the tax
system — it inspected the existing implementation from the first pass (§1-23 above),
confirmed it already satisfied most of the requirement, and made four targeted
corrections/additions.

### Step 1 — inspection findings

**What already existed:** `classifyCommunityIvaRate` (not an unconditional
`COMMUNITY ? 10% : 21%`), `CustomerType`/`QuoteOperationType`, `requiresLegalConfirmation`,
`computeQuoteTaxSnapshot`, the 40% materials-ratio threshold (inclusive at exactly 40%),
and wiring into `CreateQuoteUseCase`. All of this matched the correction task's own
requirements A-D (qualifying repair/renovation → potentially 10%; ordinary maintenance →
never automatic 10%; non-qualifying → standard treatment; insufficient data → never
silent 10%, deterministic unresolved state).

**What was missing/imprecise:**
1. The materials-ratio boundary check used `materialsAmount / taxableAmount` — a
   JavaScript floating-point division — before comparing against the 40% threshold.
   Step 5 of the correction task explicitly asks for exact (non-floating-point)
   arithmetic for this decision.
2. The persisted Quote tax snapshot did not include the customer classification
   (`customerType`) or the materials amount that fed the ratio test — Step 6 lists both
   as part of the minimum snapshot needed to reproduce *why* a rate was selected.
   `CustomerProfile.customerType` is mutable after the Quote is created, so without a
   snapshot copy the classification is not reliably reproducible later.
3. Test coverage did not explicitly exercise the exact boundary values the correction
   task calls out (39.99% / 40.00% / 40.01%), the "unknown operation type" case by that
   name, or a security test proving the client cannot submit a rate directly.

**Smallest change required:** (a) replace the division-based ratio comparison with an
exact whole-cent integer cross-multiplication, keeping the same public threshold
constant and the same outcome for every value already tested; (b) add two nullable,
additive columns to `Quote` (`customerTypeAtQuote`, `taxMaterialsAmount`) and thread
them through the existing snapshot/repository/use-case plumbing; (c) add the specific
tests the correction task enumerates. No enum was split, no existing field was
renamed, and no second tax engine or second classification path was created.

### 1. Customer classification

Unchanged from the first pass: `CustomerTypeValue` = `PRIVATE_CUSTOMER |
COMMUNITY_OF_OWNERS | COMPANY` (`domain/value-objects/customer-type.ts`), sourced from
`CustomerProfile.customerType`, resolved server-side in `CreateQuoteUseCase`.

### 2. Operation classification

Unchanged: `QuoteOperationTypeValue` = `RENOVATION_OR_REPAIR | MAINTENANCE | OTHER`
(`domain/value-objects/quote-operation-type.ts`). The correction task's Step 2 asks for
"at minimum: REPAIR, RENOVATION, MAINTENANCE, OTHER/UNKNOWN" as distinguishable
concepts. This pass evaluated splitting `RENOVATION_OR_REPAIR` into two separate enum
values and **decided not to**, and documented why directly in
`spain-community-iva-classification-policy.ts`'s own doc comment (new "Repair vs.
renovation" section): Ley 37/1992 art. 91.Uno.2.10º grants the reduced rate to "obras de
renovación y reparación" as one qualifying category, so a repair-quote and a
renovation-quote are classified identically today — the correction task's own Step 2
instruction ("do not introduce duplicate enums if an equivalent already exists")
directly supports reusing the single existing value rather than adding a distinction
this policy would treat the same way either side of the split. "Unknown" operation type
is represented by omitting `operationType` entirely (`undefined`/`null`) rather than a
fourth enum value — see point 5 below for why that is the correct "unknown" state, not
a gap.

### 3. 10% eligibility conditions

Unchanged decision table (see §3/§6 above): `customerType === COMMUNITY_OF_OWNERS` AND
`operationType === RENOVATION_OR_REPAIR` AND `isResidentialProperty === true` AND
materials-ratio at or below 40%. Every branch is covered by an explicit,
`classificationCode`-labeled outcome — never a bare boolean.

### 4. Materials threshold

**Corrected in this pass.** `isWithinMaterialsThreshold()`
(`spain-community-iva-classification-policy.ts`) now performs the eligibility
comparison as `Math.round(materialsAmount * 100) * 10000 <= Math.round(taxableAmount *
100) * 4000` — a single integer comparison with zero division and zero floating-point
rounding risk at the boundary, replacing the previous
`materialsAmount / taxableAmount > 0.4` float comparison. The documented threshold
constant (`COMMUNITY_REDUCED_RATE_MAX_MATERIALS_RATIO = 0.4`, i.e. "materials do not
exceed 40% of the taxable base") is unchanged and still the single source of truth for
the *value* — only *how it's compared* changed. The boundary remains inclusive: exactly
40% still qualifies (reading "does not exceed 40%" as `<= 40%`, not `< 40%`), confirmed
by a dedicated boundary test plus a same-behavior-under-floating-point-adversarial-input
test (833.33 / 333.33 — a ratio that is prone to float drift under division but is
computed exactly under the new integer comparison).

The denominator is unchanged from the first pass and documented explicitly: the
existing tax engine's own `taxableAmount` (labour + materials, i.e. `Quote.totalAmount`
pre-tax) — never overridden or redefined by this correction.

### 5. Unknown-data behavior

Unchanged in outcome, now with an explicit named test. When `customerType ===
COMMUNITY_OF_OWNERS` but `operationType` and/or `isResidentialProperty` is not supplied,
`classifyCommunityIvaRate` returns `classificationCode:
"ES_COMMUNITY_INSUFFICIENT_DATA_DEFAULTED_GENERAL"`, `rateBps: GENERAL (21%)`, and
`requiresLegalConfirmation: true` — never a silent 10%. This *is* the codebase's
existing equivalent of a `reducedRateEligible: unknown` state the correction task's Step
4 describes, reused rather than duplicated per that step's own instruction. No new
"UNKNOWN" enum value or additional field was introduced.

### 6. Legal confirmation flag

Unchanged semantics, restated per the correction task's Step 7 to remove any ambiguity:
`requiresLegalConfirmation: true` means *"the technical tax engine classified this
operation as potentially eligible [or as insufficiently determined], but final
legal/tax confirmation is still required before production"* — it is never a validity
error, and every reduced-rate or insufficient-data outcome sets it. It is not, itself,
a blocker to persisting or using the Quote; it is an audit/compliance signal, which is
exactly how `Quote.taxRequiresLegalConfirmation` is already exposed for later
consumption by the (future) Module 101 legal/contractual layer.

### 7. Tax snapshot

**Extended in this pass.** `QuoteTaxSnapshot` (`application/services/quote-tax-snapshot.ts`)
and `Quote` now additionally persist:
- `customerTypeAtQuote` — the customer classification *as it was when the snapshot was
  computed*, so a later change to `CustomerProfile.customerType` can never make an
  already-quoted classification unreproducible.
- `taxMaterialsAmount` — the MATERIALS-category amount that fed the ratio test, so the
  materials ratio itself is always reproducible from persisted data, not just asserted.

Combined with the pre-existing `taxableBase`, `vatRateBps`, `vatAmount`,
`grossTotalAmount`, `taxClassificationCode`, `taxRequiresLegalConfirmation`,
`taxCalculationVersion`, and `taxCalculatedAt`, a persisted Quote's IVA rate is never
stored as a bare number — it always carries the full classification context that
produced it, per Step 6's explicit requirement. `QUOTE_TAX_SNAPSHOT_VERSION` was bumped
1 → 2 to record this shape change (not a rate change — the versioning convention
distinguishes the two, see that constant's own doc comment).

New additive migration:
`prisma/migrations/20260919000000_add_module_97_community_snapshot_fields/migration.sql`
— two nullable columns (`quotes.customerTypeAtQuote`, `quotes.taxMaterialsAmount`), no
existing column touched, no backfill needed (both are null for every Quote that
predates this migration, which is simply true).

### 8. Tests

Added, this pass:
- 6 new tests in `spain-community-iva-classification-policy.test.ts`: exact 39.99% /
  40.00% / 40.01% boundary cases, a floating-point-adversarial-input case (833.33/333.33),
  repair-and-renovation-treated-identically, and an explicitly named "unknown operation
  type" case.
- 4 new tests in `quote-tax-snapshot.test.ts`: snapshot carries full Community
  classification context (not a bare rate), full snapshot on a qualifying 10% case, a
  previously-returned snapshot is unaffected by a later recomputation (simulating a
  "tax configuration changed" scenario), and private/company customers are unaffected.
- New file `tests/unit/core/application/dto/quote-tax-security.test.ts` (4 tests, Step
  12): a client-supplied `vatRateBps`/`vatRate`/`taxRate`/`taxClassificationCode`/
  `taxRequiresLegalConfirmation` is always stripped by `createQuoteSchema` before
  `CreateQuoteUseCase` ever sees it (Zod's default strip-unknown-keys behavior — no new
  validation code was needed, since the DTO never declared those fields to begin with);
  a client can only supply the factual `operationType`/`isResidentialProperty` inputs,
  never a rate; an invalid `operationType` string is rejected outright.

Total new tests this pass: **14**. Combined with the first pass's 18, Module 97 now has
**32** dedicated unit tests plus the 190+56 pre-existing regression tests re-verified
below.

### 9. Remaining legal assumptions

Unchanged from §20 above — restated for this pass's own record: the 40% materials
threshold, the exact "qualifying renovation/repair" boundary, and the meaning of
"residential property use" for a Comunidad de Propietarios all still require asesor
fiscal / abogado sign-off before any reduced-rate Quote is relied upon in production.
This correction pass changed *how precisely* the threshold is compared (exact integer
arithmetic instead of float division) — it did not change, confirm, or further assume
the threshold's *legal correctness*.

### Invoice compatibility check (Step 8)

Re-verified, not changed: `CalculateJobTaxBreakdownUseCase`
(`application/use-cases/financial/calculate-job-tax-breakdown.use-case.ts`) — the use
case Invoice generation actually calls — still derives its own labour/materials amounts
from `Quote.items` and calls `calculateMaestroYaTaxBreakdown` with **no
`taxRateBps` override**, so it always resolves the general 21% rate. It does **not**
read `Quote.taxClassificationCode`/`Quote.vatRateBps`/`Quote.customerTypeAtQuote` at
all. This means: **a Community-qualifying Quote's persisted 10% snapshot is not yet
consumed by Invoice generation** — the eventual invoice for that Job would still be
issued at 21%, silently diverging from what the customer was quoted. This is the same
gap flagged in §11/§21 of the first pass and remains open; this correction pass did not
touch `CalculateJobTaxBreakdownUseCase` or any Invoice code path, per Step 8's explicit
"do not redesign Invoice generation" instruction — it is reported here, not silently
patched.

### Payment (Step 9)

Confirmed unchanged, as instructed: `Payment.amount`, `PaymentGateway`/Stripe
`PaymentIntent` amount, and `InitiateQuotePaymentUseCase` were not touched by this
correction pass. `calculateQuoteTotal` (the function that determines what Stripe
charges) was not modified.

### Property/data model (Step 11)

Re-inspected: `Quote.isResidentialProperty` (added in the first pass) is already the
correct, minimal boolean input for "is this a dwelling" — no further field was needed
for that condition. The two fields added in this pass
(`customerTypeAtQuote`/`taxMaterialsAmount`) are snapshot-completeness fields (Step 6),
not new eligibility conditions — no new "arbitrary semantics" field was invented.

### Observability (Step 13)

Not modified this pass — no new logging call sites were added. `classifyCommunityIvaRate`
and `computeQuoteTaxSnapshot` remain pure functions with no logging of their own
(consistent with every other file in `domain/services/tax-*`); the existing structured
logger is invoked by the *use cases* that call them, not by the domain/application
service layer itself, which is where this codebase's own logging convention already
draws that line — nothing about the correction changed that boundary. If a specific
logging call site for Community classification is wanted, it belongs in
`CreateQuoteUseCase` (or a Quote-created domain event handler), and was not added here
to avoid touching that use case beyond the four field additions in Step 7.

### Legal boundary (Step 14)

This implementation is a technical tax-engine correction, not legal or tax advice. Final
confirmation from a Spanish asesor fiscal / abogado remains required before any
Community reduced-rate Quote produced by this code is relied upon for a real,
production invoice — see point 9 above and §20. Module 101 (per this task's own
framing) will handle the contractual/legal layer this module explicitly does not.

### Verification (Step 15) — exact results

- `npx tsc --noEmit` — **0 errors** outside the same two pre-existing,
  environment-blocked files from the first pass
  (`prisma-customer-profile-repository.ts`, `prisma-quote-repository.ts` — both still
  blocked solely on `npx prisma generate`, which this sandbox cannot run; see §19 for
  the exact underlying error, unchanged this pass). Confirmed the *new* fields added in
  this pass (`customerTypeAtQuote`, `taxMaterialsAmount`) produce the same class of
  (environment-only) error as every other Module 97 field, not a new/different error.
- `npx eslint` on every file changed or added in this pass — **0 errors, 0 warnings**
  (one informational "file ignored" notice for `schema.prisma`, which ESLint doesn't
  lint — expected, not an error).
- `git diff --check` — **exit 0**.
- Focused Community/tax tests — **32/32 passed**
  (`spain-community-iva-classification-policy.test.ts`: 19,
  `quote-tax-snapshot.test.ts`: 9, `quote-tax-security.test.ts`: 4).
- Regression — pre-existing Module 36/78/97 test files re-run in full:
  `spain-iva-calculator`, `tax-calculator`, `tax-engine`,
  `maestroya-tax-calculation-service` (75 tests),
  `invoicing`/`financial`/`payments` use-case suites (115 tests),
  `tests/integration/quotes` + `tests/integration/materials` (56 tests, same
  pre-existing/unrelated `PrismaClientInitializationError` sandbox warning as the first
  pass, not a failure) — **190 + 56 = 246/246 passed**.
- **Grand total this session: 32 + 246 = 278/278 executed tests passed. Zero
  regressions, zero new failures.**
- Not executed — **BLOCKED**, same reasons as §18 (no reachable Postgres, no
  `linux-arm64` Prisma engine reachable from this sandbox): `npm run test:integration:db`,
  `npm run db:migrate:test`, `npx prisma generate`/`npx prisma validate`.

### Files changed (this correction pass only)

**New:**
- `prisma/migrations/20260919000000_add_module_97_community_snapshot_fields/migration.sql`
- `tests/unit/core/application/dto/quote-tax-security.test.ts`

**Modified:**
- `prisma/schema.prisma` (two new nullable `Quote` columns)
- `src/core/domain/services/spain-community-iva-classification-policy.ts`
  (float-safe threshold comparison + doc comments)
- `src/core/application/services/quote-tax-snapshot.ts` (two new snapshot fields,
  version bump)
- `src/core/domain/repositories/quote-repository.ts` (two new fields on
  `QuoteRecord`/`CreateQuoteData`/`UpdateQuoteFields`)
- `src/core/infrastructure/database/prisma/repositories/prisma-quote-repository.ts`
  (select/mapping/create/update for the two new columns)
- `src/core/application/use-cases/quotes/create-quote.use-case.ts` (passes the two new
  snapshot fields through to persistence)
- `tests/unit/core/domain/spain-community-iva-classification-policy.test.ts` (6 new tests)
- `tests/unit/core/application/services/quote-tax-snapshot.test.ts` (4 new tests)
- `tests/unit/core/application/use-cases/payments/fakes.ts`,
  `tests/unit/core/application/use-cases/financial/calculate-job-tax-breakdown.use-case.test.ts`,
  `tests/unit/core/application/use-cases/invoicing/invoicing-use-cases.test.ts`,
  `tests/unit/core/application/use-cases/invoicing/module-85-activation.test.ts`,
  `tests/integration/quotes/fakes.ts`, `tests/integration/gdpr/fakes.ts` (added the two
  new fields to existing `QuoteRecord` test fixtures so they keep compiling)
- `MODULE_97_TAX_IVA_PRODUCTION_INTEGRATION_REPORT.md` (this section)

No git staging, commit, push, branch, or destructive database operation was performed.

### Remaining risks (this pass)

All risks from §21 remain (Payment/Invoice figure mismatch, Invoice generation not yet
consuming the Quote's classification, `UpdateQuoteUseCase` not recomputing the snapshot
on edit, Prisma Client not regenerated, no real-Postgres verification). This pass did
not close any of them — it was explicitly scoped not to (Steps 8/9 forbid touching
Invoice/Payment in this task) — and did not introduce new ones. The
Invoice-doesn't-consume-the-snapshot gap (this section's "Invoice compatibility check")
is the most actionable next step, since the Community classification work is otherwise
complete and tested but currently only affects the Quote a customer sees, not the
eventual invoice.

**Status: READY WITH CONDITIONS** — the Community IVA classification itself (Steps 1-7,
10-14 of the correction task) is complete, tested, and float-safe. Conditions:
(1) asesor fiscal / abogado confirmation of the eligibility criteria and threshold
before production reliance; (2) Invoice generation needs a follow-up change to consume
`Quote.taxClassificationCode`/`vatRateBps` instead of always resolving the general
rate; (3) `npx prisma generate` should be run and `npx tsc --noEmit` re-verified outside
this sandbox.

## 25. Invoice Tax Snapshot Integration (Final Pass — Session 3)

### Previous behavior

Every Quote since Module 97 shipped has persisted an authoritative, immutable tax
snapshot (`taxableBase`, `vatRateBps`, `vatAmount`, `grossTotalAmount`,
`taxClassificationCode`, `taxRequiresLegalConfirmation`, `taxCalculationVersion`,
`taxCalculatedAt`) at Quote-creation time via `computeQuoteTaxSnapshot`. However,
neither `CreateProfessionalInvoiceDraftUseCase` nor `CreateCustomerReceiptDraftUseCase`
ever read that snapshot when generating an invoice. Both call
`CalculateJobTaxBreakdownUseCase.execute(jobId)` with no options, which has always
accepted an optional `taxRateBps` override but silently fell through to
`calculateMaestroYaTaxBreakdown`'s bare default (Spain's general 21% rate) whenever no
override was supplied. The net effect: **a Community-of-Owners Quote correctly
classified at 10% IVA still produced an invoice at 21%** — the exact gap §21/§24 flagged
as the most actionable remaining risk.

### Problem

Invoice generation was independently re-deciding the IVA rate rather than treating the
Quote's own persisted classification as authoritative — precisely the
`COMMUNITY ? 10% : 21%`-style shortcut the whole module was built to avoid, just
relocated to the invoice boundary instead of the Quote boundary.

### Authoritative source

For an invoice generated from a given Quote, that Quote's own persisted tax snapshot
(`taxableBase`/`vatRateBps`/`vatAmount`/`grossTotalAmount`) is authoritative. No new
`Invoice` columns were added for classification provenance
(`customerTypeAtQuote`/`taxClassificationCode`/`taxCalculationVersion`) — the existing
`Invoice.taxableBase`/`vatRateBps`/`vatAmount`/`totalAmount` fields already satisfy the
numeric-parity objective this task set out (identical taxable base, rate, VAT amount,
and gross total), and full classification provenance remains reachable via the
pre-existing `Invoice.quoteId -> Quote` relationship whenever it's needed. This was a
deliberate choice against blindly duplicating data onto a second model, per Step 2/10's
own instruction.

### Implementation

Two layered changes, both additive and both reusing Module 78's existing override
mechanism — no second tax engine, no new tax rule:

1. **`CalculateJobTaxBreakdownUseCase.execute()`** (the single choke point both invoice
   drafts and `CreateCreditNoteUseCase.deriveReversal` all call): changed
   `options.taxRateBps` (an explicit caller override, unchanged, still wins) to fall
   back to `quote.vatRateBps` *before* falling through to the calculator's bare
   general-rate default:
   ```ts
   const taxRateBps = options.taxRateBps ?? quote.vatRateBps ?? undefined;
   ```
   A new `usedQuoteTaxSnapshotRate: boolean` field was added to
   `JobTaxBreakdownResult` purely as an observability/testing signal (never itself a
   financial decision) recording whether the rate came from the Quote's own snapshot.
   Because all three consumers (`CreateProfessionalInvoiceDraftUseCase`,
   `CreateCustomerReceiptDraftUseCase`, `CreateCreditNoteUseCase.deriveReversal`) share
   this one use case, this single fix transitively corrects all three — no changes were
   needed in `create-professional-invoice-draft.use-case.ts` or
   `create-credit-note.use-case.ts` themselves. The professional invoice's own
   `professionalVatRateBps`/`professionalVatAmount` already derive internally from this
   same overridden rate (confirmed from `maestroya-tax-calculation-service.ts`), and its
   commission figures are computed independently of any rate change, so Step 8's
   "do not change commission economics" constraint holds unmodified.

2. **`CreateCustomerReceiptDraftUseCase`**: added a second, stronger layer for maximal
   literal fidelity to Step 5's "do NOT call the current tax engine again merely to
   generate the invoice" instruction. When the Quote carries a complete tax snapshot
   (`taxCalculatedAt`/`taxableBase`/`vatRateBps`/`vatAmount`/`grossTotalAmount` all
   non-null), the receipt's four tax fields are read **directly** from the Quote's
   snapshot fields, byte-for-byte, bypassing recomputation entirely rather than merely
   relying on the rate-override producing the same numbers:
   ```ts
   taxableBase: hasQuoteTaxSnapshot ? quote.taxableBase : breakdown.customerTaxableBase,
   vatRateBps: hasQuoteTaxSnapshot ? quote.vatRateBps : breakdown.customerVatRateBps,
   vatAmount: hasQuoteTaxSnapshot ? quote.vatAmount : breakdown.customerVatAmount,
   totalAmount: hasQuoteTaxSnapshot ? quote.grossTotalAmount : breakdown.customerGrossTotal,
   ```
   A Quote that predates Module 97 (`taxCalculatedAt: null`) has no snapshot to prefer
   and falls back to exactly today's pre-existing behavior (the recomputed general-rate
   breakdown) — zero change for legacy Quotes. `commissionBase/RateBps/Amount` and
   `irpfWithholdingRateBps/Amount` remain explicitly zeroed on the customer receipt,
   unchanged from before.

Neither `Payment.amount`, Stripe charging, commission economics, nor Module 96
affiliate behavior were touched.

### Worked Community example (verified by test)

Quote: `taxableBase = €1,000`, `vatRateBps = 1000` (10%), `vatAmount = €100`,
`grossTotalAmount = €1,100`, `customerTypeAtQuote = COMMUNITY_OF_OWNERS`,
`taxClassificationCode = ES_COMMUNITY_QUALIFYING_RENOVATION_REDUCED`. Resulting customer
receipt: `taxableBase = €1,000`, `vatRateBps = 1000`, `vatAmount = €100`,
`totalAmount = €1,100` — identical to the Quote, exactly as required. The resulting
professional invoice also carries `vatRateBps = 1000` (no independent 21% re-decision),
verified by a dedicated test.

### Regression coverage

Added 11 new focused tests to
`tests/unit/core/application/use-cases/invoicing/module-85-activation.test.ts` under
"Module 97 correction pass — Invoice Tax Snapshot Integration": the worked €1,000/10%/
€100/€1,100 example on both the customer receipt and the professional invoice; a
Community non-qualifying (standard-rate) Quote whose snapshot is preserved verbatim; a
Private-customer regression (legacy no-snapshot Quote falls back to the pre-existing
recomputed 21% breakdown); a Company-customer regression (standard-rate snapshot flows
through unchanged); a "tax configuration changes after Quote creation" test proving the
invoice still uses the original 10% snapshot even after the commission-rate repository's
"current" rates change; a security test proving there is no parameter (type-level or
runtime) through which a caller can override an invoice's tax fields — both draft use
cases accept only a `jobId`, and no API/DTO layer exists for either at all; a financial-
consistency test confirming `taxableBase + vatAmount === totalAmount` exactly (whole-cent
arithmetic) for both a snapshot-sourced and a legacy recomputed invoice; and partial/
full-refund credit-note tests plus a duplicate-refund-event idempotency test, all against
a Community invoice issued at 10%, confirming the credit note's own `reversedVatRateBps`
is always read from the already-issued invoice rather than recalculated.

All 22 tests in that file pass (11 new + 11 pre-existing, no regressions). The full
Module 36/78/97 tax-domain suite (`spain-iva-calculator`, `tax-calculator`, `tax-engine`,
`maestroya-tax-calculation-service`, `spain-community-iva-classification-policy`,
`quote-tax-snapshot`, `quote-tax-security`, `calculate-job-tax-breakdown.use-case`,
`reconciliation/tax-checks`) remains fully green: **119/119**. The broader
invoicing/reconciliation/refund suite (`invoicing-use-cases`,
`dispute-financial-outcome-refund-executor`, `dispute-resolution-financial-outcome`,
`financial-reconciliation`, and the `reconciliation/*-checks` domain suites) also
remains fully green: **109/109**. Combined with the 22 in `module-85-activation.test.ts`,
this pass verified **250/250 executed tests passing, zero regressions**.

### Refund / CreditNote compatibility

`CreateCreditNoteUseCase` was inspected and required **no code changes**. Its
`reversedVatRateBps: invoice.vatRateBps` was already sourced directly from the
persisted, already-issued Invoice (never recalculated) — confirmed correct and
unaffected. Its `deriveReversal()` calls `this.taxBreakdowns.execute(jobId)` fresh to
compute the *original* breakdown before applying `calculateTaxReversal`; since that call
now transitively benefits from the same `quote.vatRateBps` fallback, a Community
invoice's credit notes are automatically reversed at the correct 10% basis too, with
zero changes needed in `create-credit-note.use-case.ts` itself. Partial-refund,
full-refund, and duplicate-refund-event idempotency were all verified by new tests
against a Community (10%) invoice, in addition to the pre-existing general-rate
coverage in `invoicing-use-cases.test.ts` and `module-85-activation.test.ts`.

### Remaining Payment.amount issue (documented, not fixed — out of scope)

While building the refund test coverage, this pass observed directly (not merely
inferred) the pre-existing Payment/breakdown-vs-Quote-snapshot mismatch §9/§21 already
flagged: `CalculateJobTaxBreakdownUseCase` derives the *customer*-side gross total by
recomputing from the Quote's own line items at the (now correctly overridden) rate —
e.g. €1,200 base x 10% = €1,320 — which need not equal the Quote's own persisted
`grossTotalAmount` snapshot (€1,100 in the worked example above) if the Quote's items
were ever edited after the snapshot was taken, or if the snapshot's own materials/labour
split differs from a simple item-sum. This is the same category of pre-existing
inconsistency §1/§9 already documented for `Payment.amount` vs. the customer receipt's
`customerGrossTotal` — this pass did not introduce it, does not fix it (Payment.amount
and Stripe charging remain untouched, per this task's explicit constraints), and
confirms it remains a separate, already-tracked financial-reconciliation risk rather
than a defect in the fix delivered here. The customer receipt itself is unaffected by
this discrepancy because it now reads the Quote's snapshot fields directly rather than
via the recomputed breakdown (see "Implementation," layer 2, above) — the discrepancy
only surfaces in the professional-invoice/credit-note math, which was already how the
codebase worked before this pass.

### Legal assumptions (unchanged, restated)

Same as §21/§24: nothing in this pass changes or newly asserts any legal conclusion.
`taxRequiresLegalConfirmation` continues to be preserved verbatim from the Quote's
snapshot onto the derived invoice's tax treatment (it is not itself a separate
persisted Invoice field, but the classification it flags remains reachable via
`Invoice.quoteId -> Quote.taxRequiresLegalConfirmation`). Final asesor fiscal / abogado
sign-off on the Community eligibility criteria, materials threshold, and any required
invoice wording remains outstanding, as does the broader self-billing/legal-contract
architecture (future Legal Module, out of scope here).

### Verification results (this pass)

- `npx tsc --noEmit` — clean except the two pre-existing, sandbox-only,
  Prisma-Client-generation-blocked files (`prisma-customer-profile-repository.ts`,
  `prisma-quote-repository.ts`), unchanged in kind and count from every prior pass.
- `npx eslint` on every file touched this pass
  (`calculate-job-tax-breakdown.use-case.ts`, `create-customer-receipt-draft.use-case.ts`,
  `create-professional-invoice-draft.use-case.ts` (inspected, not modified),
  `create-credit-note.use-case.ts` (inspected, not modified),
  `module-85-activation.test.ts`, `tests/unit/core/domain/reconciliation/fixtures.ts`)
  — **0 errors, 0 warnings**.
- `git diff --check` — **exit 0**.
- Focused test file (`module-85-activation.test.ts`) — **22/22 passed**.
- Regression — Module 36/78/97 tax-domain suite — **119/119 passed**.
- Regression — invoicing/reconciliation/refund suite — **109/109 passed**.
- **Grand total this pass: 250/250 executed tests passed. Zero regressions, zero new
  failures.**
- Not executed — **BLOCKED**, same pre-existing sandbox reasons as every prior pass
  (no reachable Postgres, no `linux-arm64` Prisma engine reachable from this sandbox):
  `npm run test:integration:db`, `npm run db:migrate:test`,
  `npx prisma generate`/`npx prisma validate`. No database migration was required for
  this pass (existing `Invoice`/`Quote` columns were sufficient), so this is unchanged
  risk, not new risk.

### Files changed (this pass only)

**Modified:**
- `src/core/application/use-cases/financial/calculate-job-tax-breakdown.use-case.ts`
  (rate fallback to `quote.vatRateBps`; new `usedQuoteTaxSnapshotRate` field)
- `src/core/application/use-cases/invoicing/create-customer-receipt-draft.use-case.ts`
  (direct snapshot-field sourcing when a Quote tax snapshot exists)
- `tests/unit/core/domain/reconciliation/fixtures.ts` (`makeTaxBreakdown` factory:
  added the new `usedQuoteTaxSnapshotRate` field to keep compiling)
- `tests/unit/core/application/use-cases/invoicing/module-85-activation.test.ts`
  (11 new tests under "Module 97 correction pass — Invoice Tax Snapshot Integration")
- `MODULE_97_TAX_IVA_PRODUCTION_INTEGRATION_REPORT.md` (this section, header pointer)

**Inspected, not modified** (confirmed to need no changes — see "Implementation" above):
- `src/core/application/use-cases/invoicing/create-professional-invoice-draft.use-case.ts`
- `src/core/application/use-cases/invoicing/create-credit-note.use-case.ts`

No new Prisma migration was created — the existing `Invoice` schema already had every
field this task's objective required. No git staging, commit, push, branch, or
destructive database operation was performed.

### Final status

**Status: READY WITH CONDITIONS.** The specific functional gap this task targeted —
Invoice generation ignoring the Quote's tax snapshot — is fixed, tested, and verified
with zero regressions across 250 executed tests. Conditions (carried over, unchanged by
this pass): (1) asesor fiscal / abogado confirmation of the Community eligibility
criteria and materials threshold before production reliance on any REDUCED-rate result;
(2) the pre-existing Payment.amount / recomputed-breakdown-gross mismatch (§1/§9,
restated above) remains a separate, documented financial-reconciliation risk requiring
its own dedicated decision — deliberately not addressed here per this task's explicit
scope; (3) `npx prisma generate` should be run and `npx tsc --noEmit` re-verified
outside this sandbox before merge; (4) real-Postgres integration coverage for the
invoice-generation path remains outstanding for the same sandbox reasons as every prior
pass.

## 26. Full-Suite Regression Fix — Health Readiness Timeout (Session 4)

### Context

A full local `npm test` run after the Session 3 changes above reported 5091/5093 tests
passing, with exactly two failures, both `Test timed out in 5000ms`:

- `tests/integration/backup/backup-health-route-wiring.test.ts` — "reports both checks
  as 'disabled' by default, without affecting overall readiness" (Module 54)
- `tests/integration/database/read-replicas-health-route-wiring.test.ts` — "reports
  'disabled' by default, without affecting overall readiness" (Module 55)

### Root cause

**Pre-existing test-timing-margin defect, not a Module 97 logic defect** — the exact
same class of problem already root-caused and fixed once before, for two *different*
files, and documented in `MODULE_78_HEALTH_TEST_TIMEOUT_AUDIT.md`.

Both failing tests do a real `vi.resetModules()` followed by a fresh dynamic `import()`
of the actual `/api/health/ready` route — deliberate end-to-end wiring coverage of the
real composition root (not a mock), exercising every registered health check
(database, cache, queue, search engine, SMS, analytics, tracing, configuration, backup,
disaster recovery, read replicas) via one real `GET()` call. Direct measurement in this
sandbox confirmed this pattern alone costs **~3.9-4.5 seconds**, even in near-isolation
on an idle 4-core machine (`nproc` confirms 4 cores here, matching the Module 78 audit's
own environment) — 78-90% of Vitest's default 5000ms `testTimeout`, before any
concurrent-suite contention is added. Running these two files alongside a batch of other
integration test files reproduced the failure directly (one run showed the
read-replicas file's own heaviest test intermittently pushed over budget under load,
exactly the flaky-under-contention signature the Module 78 audit describes).

Two other test files already exercise this identical `vi.resetModules()` + dynamic
`import()` of the identical `/api/health/ready` route —
`tests/integration/health/health-routes-wiring.test.ts` and
`tests/integration/observability/health-routes.test.ts` — and both already carry a
one-line, file-scoped `vi.setConfig({ testTimeout: 20000 })` override, added specifically
to fix this exact defect when it first surfaced during Module 78's own full-suite run
(see `MODULE_78_HEALTH_TEST_TIMEOUT_AUDIT.md` for that investigation in full). The two
Module 54/55 wiring test files reproduce the identical pattern against the identical
route but were **never given that same established safeguard** — confirmed directly by
grepping both files for `vi.setConfig`/`testTimeout` before this fix (absent in both,
present in the two precedent files). That is the entire root cause: not a database,
Redis, backup-provider, or read-replica connectivity problem, not a leaked mock or
leaked environment variable, and not anything introduced by Module 97's own tax/invoice
changes (§25 above) — Module 97 did not touch either failing test file, the
`/api/health/ready` route, or any of the health-check compose modules it aggregates.

### Was this caused by Module 97, or merely exposed by it?

**Neither, precisely** — it predates Module 97 entirely (the two affected test files
belong to Modules 54/55, added before this session's work began) and was not introduced
or altered by anything in §25. Running the full suite after Module 97's changes was
simply the occasion this pre-existing, already-known class of defect resurfaced in two
files that had never received the fix already applied elsewhere for the same defect —
structurally identical to how the Module 78 audit describes its own trigger ("Module
78's own new test files ... add measurable but modest extra parallel-worker load ...
enough to be the straw that pushes two already-marginal tests over their already-tight
5000ms budget — but the margin was already this thin before Module 78 existed").

### Fix

Added the identical one-line, file-scoped override already established as correct for
this exact defect, with a doc comment explaining why and pointing at this precedent, to
both affected files:

```ts
vi.setConfig({ testTimeout: 20000 });
```

placed after imports/doc-comment, before the first `describe`, in:

- `tests/integration/backup/backup-health-route-wiring.test.ts`
- `tests/integration/database/read-replicas-health-route-wiring.test.ts`

No test assertion, mock, or test case was added, removed, or weakened — every existing
`it(...)` body is byte-for-byte unchanged. `vitest.config.ts`'s global `testTimeout`
was **not** touched, so every other test file in the suite keeps its original, tight
5000ms fast-failure budget exactly as before — this is a per-file override, the same
category of fix Vitest itself provides for exactly this situation, not a global
loosening. No production code was touched: `/api/health/ready/route.ts`, every
`infrastructure/*/compose.ts` health-check function, `env.ts`, and the backup/read-replica
health-report logic itself are all unchanged. 20000ms matches the exact value already
used by the two precedent files, chosen there as 4-5x the worst measured duration —
consistent, not a new arbitrary number.

### Regression protection

No new regression test was added. The existing tests in both files already fully cover
the intended behavior (backup/read-replica checks report `"disabled"` by default without
affecting overall readiness) — the defect was purely a timing budget on an already-
correct, already-tested assertion, not a missing test case. Adding another test would be
redundant per Step 6's own instruction.

### Tests executed

- `tests/integration/backup/backup-health-route-wiring.test.ts` alone — **2/2 passed**
  (run 3x for stability).
- `tests/integration/database/read-replicas-health-route-wiring.test.ts` alone —
  **3/3 passed** (run 3x for stability; consistently 3.9-4.5s for the heaviest test,
  confirming the margin diagnosis).
- Both files together — **5/5 passed**.
- Both files together with 19 other integration test files (backup, database, health,
  observability, performance, analytics, materials, quotes, financial, professional,
  company, verification, config — 21 files total, deliberately inducing the same
  concurrent-CPU contention that originally triggered the failure) — **296/296 passed**,
  zero timeouts.
- `npx tsc --noEmit` — clean except the two pre-existing, sandbox-only,
  Prisma-Client-generation-blocked files, unchanged from every prior pass.
- `npx eslint` on both changed files — **0 errors, 0 warnings**.
- `git diff --check` — **exit 0**.
- Only the two intended test files appear in `git status` beyond this session's
  Section 25 changes — no unrelated file was touched.
- Not re-run to full completion in this sandbox: the complete 593-file/5093-test
  `npm test` — this environment hard-caps each shell command's wall-clock budget, well
  under what a full run requires (the same limitation the Module 78 audit already
  documented). Every subset run to completion above — including a 21-file, 296-test
  batch specifically chosen to reproduce the original contention — passed with zero
  failures. **Recommend running the complete `npm test` once more outside this sandbox**
  to get the authoritative final count before merging, per the same recommendation the
  Module 78 audit already made for the identical constraint.

### Verification results (this pass)

- Typecheck: clean (same 2 known pre-existing Prisma-blocked files only).
- Lint: 0 errors, 0 warnings on both changed files.
- `git diff --check`: exit 0.
- No git staging, commit, push, branch, or destructive database operation was
  performed.

### Remaining issue

None specific to this fix. The pre-existing, sandbox-only Prisma linux-arm64 query-engine
mismatch continues to surface as unrelated "Unhandled Rejection" warnings in a small
number of tests that use a real (unmocked) Prisma client
(`getBackupHealth()/getRecoveryHealth() are directly importable...`,
`GenerateCapacityReportUseCase` performance tests) — identical to what the Module 78
audit already documented, does not affect any test's pass/fail outcome, and was not
introduced or touched by this fix.

**Files changed (this pass only):**
- `tests/integration/backup/backup-health-route-wiring.test.ts` (added
  `vi.setConfig({ testTimeout: 20000 })` + doc comment)
- `tests/integration/database/read-replicas-health-route-wiring.test.ts` (same)
- `MODULE_97_TAX_IVA_PRODUCTION_INTEGRATION_REPORT.md` (this section)

No production file, migration, or unrelated test was changed. No git operations were
performed.
