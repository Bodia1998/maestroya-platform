# Module 78 — IVA / Tax Integration — Implementation Report

## 1. Executive Summary

Module 78 adds the single authoritative IVA/tax calculation layer for MaestroYa: `calculateMaestroYaTaxBreakdown` (domain) and `CalculateJobTaxBreakdownUseCase` (application), plus a refund/credit-note reversal helper (`calculateTaxReversal`). It computes, for a single Job/Quote:

- the customer-facing taxable base, IVA, and gross total,
- MaestroYa's 10% commission (by delegating to Module 64's existing commission engine — never re-derived),
- the professional's own self-billing invoice: net base after commission, IVA on that net base, and invoice total,
- IRPF withholding as an explicit field, defaulted to €0 under the current MaestroYa/AEAT model,
- and enough structure for Module 79 to compute original/refunded/remaining IVA for a credit note.

No database schema changes were made. No existing file's behavior was changed — Module 78 is purely additive, sitting on top of the existing commission and tax-calculator code. The canonical worked example from the spec reproduces exactly: customer pays €1,452 (€1,200 base + €252 IVA), MaestroYa commission €120, professional invoice €1,306.80 (€1,080 net + €226.80 IVA), IRPF €0.

A real contradiction was found between the Module 78 spec and Module 64's existing commission engine regarding customer-purchased materials (Scenario B) — see §3. It was **not** silently resolved by changing Module 64; Module 78's own tax calculation follows the Module 78 spec's rule, and the discrepancy is flagged for the Module 64/79 owners and the asesor.

## 2. Existing Tax Architecture Before Module 78

The repository already had substantial tax scaffolding, all pre-dating this module:

- `domain/services/money.ts` — `roundToCents`, the codebase-wide convention (plain `number`s, rounded to whole cents at every step, no decimal library). Reused as-is.
- `domain/services/commission-policy.ts` / `commission-calculation-service.ts` (Module 64, referred to as "Module 65" in this task's brief — see §3a) — the single source of truth for MaestroYa's flat 10% commission on `labour + materials`. This is the corrected model (replacing a removed 7.5%/7.5% dual-fee model). Reused as-is, never duplicated.
- `domain/services/tax-calculator.ts` — the country-agnostic `TaxCalculator` contract, `resolveTaxCalculator`, and a `TaxCalculatorRegistry`.
- `domain/services/spain-iva-calculator.ts` — `SpainIvaCalculator`, implementing Spain's four official IVA rates (21% general / 10% reduced / 4% super-reduced / 0% exempt), with rate validation (`InvalidTaxRateError`).
- `domain/services/tax-engine.ts` — `calculatePriceBreakdown`, which computes a **customer-facing only** breakdown: `taxableAmount = serviceAmount + materialsAmount`, IVA on top, MaestroYa's commission shown as an informational (never customer-charged) figure.

All of the above were correctly implemented and are still correct for what they cover. **Reused unchanged** by Module 78.

### What did not exist before Module 78

- Any calculation of the **professional's own invoice** tax figures (net base after commission, IVA on that base). This is not "extra payout money" — the spec explicitly requires it be represented as tax data, and nothing in the repository did that.
- Any distinction between professional-supplied materials (Scenario A) and customer-purchased materials (Scenario B) at the tax/commission-input level.
- Any IRPF field, anywhere in the codebase (`grep -rn "IRPF\|irpf"` returned zero results before this module).
- Any refund/credit-note tax-reversal preparation.
- Any real caller of `calculatePriceBreakdown` — it is dead code (`grep -rln "calculatePriceBreakdown"` matches only its own file and its own test file). It was written under "Module 36 — Tax Engine Preparation" and never wired into a use case.

## 3. Problems Found

### 3a. Module numbering mismatch (not a defect, noted for traceability)

The task brief refers to "Module 65: Commission calculation" and "Modules 73–77" for payment/registration/payout/refund. In this repository's own git history and `docs/`, the 10%-commission correction is **Module 64** ("Pricing & Commission Engine"), and Module 65's own doc (`MODULE_65_TRUST_AND_INTEGRITY_SYSTEM.md`) is an unrelated Trust & Integrity module. The commit log confirms: `feat(module-77)`, `feat(module-75)`, `feat: implement business registration enforcement` (74), `feat(payments): implement real customer payment capture` (73) — these line up with the brief's Modules 73–77 by content, just not always by the doc filenames on disk (73–75, 77 have no standalone `MODULE_7X_*.md`; only Module 76 does). Module 78 was implemented against the **actual code**, not the numbering, and reuses exactly the commission engine and payment/payout/refund infrastructure the brief describes, regardless of which module number the repo's own history attaches to each.

### 3b. A genuine, confirmed contradiction: customer-purchased materials and the commission base

This is the contradiction the task explicitly asked to be flagged rather than silently resolved.

- The Module 78 spec (Scenario B) requires: when the customer buys materials directly, those materials are **never** part of the professional's commission base or taxable base.
- Module 64's own commission engine (`commission-calculation-service.ts`) has this doc comment, verbatim: *"materials: ... Commissionable under Module 64, regardless of who purchased them (`materialsStrategy` ... is entirely orthogonal to commission; the commission is charged on the value of the materials, never on who sourced them)."*
- `CalculateJobCommissionBreakdownUseCase` (Module 64's own use case) sums **every** `MATERIALS`-category `QuoteItem` into `materialsSubtotal`, with **no check at all** against `Quote.materialsStrategy`.

In practice this is usually harmless: `QuoteMaterial` (the `CUSTOMER_PURCHASED` checklist) has no price field at all (see `quote-repository.ts`'s own doc comment — "Deliberately has no price/amount field ... exists only to tell the customer what to go buy, never to price anything"), so a `CUSTOMER_PURCHASED` quote *should* never carry a priced `MATERIALS` `QuoteItem` in the first place. But nothing in `CreateQuoteUseCase`/`UpdateQuoteUseCase` actually **prevents** a professional from adding a priced `MATERIALS` `QuoteItem` to a quote whose `materialsStrategy` is `CUSTOMER_PURCHASED`. If that ever happens, Module 64's existing commission engine would (per its own documented design) still commission it — directly contradicting the Module 78 spec's Scenario B rule.

**Resolution taken:** Module 78 does **not** modify Module 64's engine or its doc comment — that would be a silent, out-of-scope behavior change to an already-shipped, already-tested module, and risks being wrong in a direction the Module 64 team may have intended for other reasons. Instead:

- `calculateMaestroYaTaxBreakdown` only ever receives a `professionalMaterialsAmount` figure — it never receives "all materials" and never trusts a caller to have already filtered them.
- `CalculateJobTaxBreakdownUseCase` (Module 78's own use case) explicitly derives `professionalMaterialsAmount` by checking `quote.materialsStrategy === "PROFESSIONAL_SUPPLIED"` before counting a `MATERIALS` `QuoteItem` — so even if a `CUSTOMER_PURCHASED` quote somehow carries a priced `MATERIALS` item, Module 78's own tax/commission figures correctly exclude it, at the cost of diverging from what `CalculateJobCommissionBreakdownUseCase` would compute for the same quote in that edge case.

**Flagged, not fixed:** this means `CalculateJobCommissionBreakdownUseCase`'s output and `CalculateJobTaxBreakdownUseCase`'s output **can disagree** on `materialsSubtotal`/`commissionAmount` for a malformed `CUSTOMER_PURCHASED` quote carrying a priced `MATERIALS` item. The asesor/product owner should decide whether (a) `CreateQuoteUseCase`/`UpdateQuoteUseCase` should be hardened to reject a priced `MATERIALS` item on a `CUSTOMER_PURCHASED` quote (closing the gap at the source), or (b) Module 64's engine should itself be updated to accept a `materialsStrategy` and apply the same exclusion Module 78 now applies. Module 78 deliberately does not make that call unilaterally.

### 3c. Customers are not actually charged IVA today, and professionals are not actually paid IVA today

This is the most significant finding, and is a **pre-existing gap in production behavior**, not something Module 78 was asked to fix (invoicing/self-billing mechanics are explicitly Module 79's scope).

- `InitiateQuotePaymentUseCase` sets the Stripe `PaymentIntent` amount to `calculateQuoteTotal(items)` — i.e. `labour + materials`, the **pre-tax** base. IVA is never added.
- `ExecuteProfessionalPayoutUseCase` (Module 76) derives the Stripe transfer amount from the recorded `Commission`, i.e. `total - commission` — again the pre-tax net base, with no IVA added back.
- `calculatePriceBreakdown` (the one place in the pre-existing code that *does* compute IVA correctly) is never called by any use case.

In other words: **today, in this codebase, no IVA is actually collected from the customer via Stripe, and no IVA is actually paid to the professional via the Stripe transfer.** Module 78 provides the correct calculation (`customerGrossTotal`, `professionalInvoiceGrossTotal`) but deliberately does **not** rewire `InitiateQuotePaymentUseCase` or `ExecuteProfessionalPayoutUseCase` to use it — the task brief explicitly scopes "Do NOT duplicate ... payment calculation ... payout calculation" to Module 78, and scopes invoicing/self-billing mechanics (which is presumably how this actually gets resolved — the professional's self-billing invoice, not necessarily the Stripe charge amount, may be the legally operative document) to Module 79. See §18 for why this is flagged as a risk rather than fixed here.

## 4. Changes Made

All changes are additive; no existing file's runtime behavior was modified except `compose.ts`, which only gained one new wiring function.

### Files Created

- `src/core/domain/services/maestroya-tax-calculation-service.ts` — the Module 78 domain service: `calculateMaestroYaTaxBreakdown`, `calculateTaxReversal`, `CURRENT_IRPF_WITHHOLDING_RATE_BPS`.
- `src/core/application/use-cases/financial/calculate-job-tax-breakdown.use-case.ts` — `CalculateJobTaxBreakdownUseCase`, the Job/Quote-aware application-layer wrapper (mirrors `CalculateJobCommissionBreakdownUseCase`'s own shape and dependencies).
- `tests/unit/core/domain/maestroya-tax-calculation-service.test.ts` — 34 tests.
- `tests/unit/core/application/use-cases/financial/calculate-job-tax-breakdown.use-case.test.ts` — 5 tests, with local in-memory fakes (matching this codebase's own "one fakes set per module's test file" convention).

### Files Modified

- `src/core/application/use-cases/financial/compose.ts` — added one import and one `makeCalculateJobTaxBreakdownUseCase()` factory, reusing the existing `jobs`/`quotes`/`rates` repository instances already constructed in that file. No existing export changed.

## 5. Final Tax Model

`calculateMaestroYaTaxBreakdown(input) -> MaestroYaTaxCalculationResult`:

| Field | Meaning |
|---|---|
| `labourBase`, `professionalMaterialsBase`, `customerMaterialsBase` | Inputs echoed back, rounded. `customerMaterialsBase` is informational only — never enters any base below. |
| `customerTaxableBase` | `labourBase + professionalMaterialsBase`. |
| `customerVatRateBps`, `customerVatAmount` | IVA on `customerTaxableBase`, via the resolved `TaxCalculator`. |
| `customerGrossTotal` | `customerTaxableBase + customerVatAmount` — what the customer pays. |
| `commissionBase`, `commissionRateBps`, `commissionAmount` | Delegated entirely to Module 64's `calculateCommissionBreakdown` — never re-derived. |
| `professionalNetBase` | `commissionBase - commissionAmount` (`= Commission.professionalPayout`, renamed here because it is a taxable base, not a payout figure). |
| `professionalVatRateBps`, `professionalVatAmount` | IVA on `professionalNetBase`, same calculator/rate as the customer side. |
| `professionalInvoiceGrossTotal` | `professionalNetBase + professionalVatAmount`. |
| `irpfWithholdingRateBps`, `irpfWithholdingAmount` | Defaults to 0/0; withheld (when non-zero) on `professionalNetBase`, never on IVA. |
| `professionalPayoutAmount` | `professionalInvoiceGrossTotal - irpfWithholdingAmount`. |

`calculateTaxReversal(original, refundedGrossAmount) -> TaxReversalResult` derives proportional original/refunded/remaining figures for both the customer and professional sides, reconciled so refunded base + refunded IVA always sum exactly to the refunded gross amount (no independent rounding drift).

## 6. Customer Payment Example (canonical)

Labour €1,000 + professional materials €200 → taxable base €1,200 → IVA 21% = €252 → **customer pays €1,452**. Verified by test.

## 7. Professional Invoice Example (canonical)

Commission base €1,200 → commission €120 → professional net base €1,080 → professional IVA (21% of €1,080) = **€226.80** → **professional invoice total €1,306.80**. Verified by test, matches the spec exactly to the cent.

## 8. Materials Scenario A (professional-supplied)

Labour €1,000, professional materials €200 → both commissionable and taxable, exactly as §6/§7. Verified by test.

## 9. Materials Scenario B (customer-purchased)

Labour €1,000, customer buys €200 of materials directly. `professionalMaterialsAmount = 0`, `customerMaterialsAmount = 200`. Result: `customerTaxableBase = 1000`, commission = €100, professional net base = €900, professional IVA = €189. The €200 never appears in any commissioned/taxed figure. Verified by test, including the use-case-level test that exercises `Quote.materialsStrategy = CUSTOMER_PURCHASED` end-to-end.

## 10. IRPF Treatment

`CURRENT_IRPF_WITHHOLDING_RATE_BPS = 0`, per direct confirmation from Agencia Tributaria relayed in the spec: MaestroYa does not withhold IRPF from professionals under the current intermediary model. This is a **default**, not a hardcoded impossibility — `MaestroYaTaxCalculationInput.irpfWithholdingRateBps` accepts an explicit override (validated to `0..10000` bps), so a future confirmed policy change requires only a new input value, never a new field or a code change to this module. No per-professional IRPF logic was invented.

## 11. Commission Treatment

Never re-implemented. `calculateMaestroYaTaxBreakdown` calls `calculateCommissionBreakdown` (Module 64) exactly once, passing only `labourAmount`/`professionalMaterialsAmount` (never `customerMaterialsAmount`, never a gross/tax-inclusive amount). Tests assert byte-for-byte agreement between Module 78's `commissionAmount`/`professionalNetBase` and both `calculateCommissionBreakdown` and `COMMISSION_CALCULATION_SERVICE.calculate` called directly on the same inputs — this is the "integration with the existing commission service" the spec requires, proven rather than assumed.

## 12. Rounding Rules

Exclusively `roundToCents` from the existing `domain/services/money.ts` — no second money/rounding implementation was introduced anywhere. Every arithmetic step (taxable base, IVA, commission, net base, professional IVA, IRPF, payout, and every reversal figure) is rounded to whole cents at that step, matching the codebase-wide convention. Fractional-cent inputs (e.g. €33.33 + €11.11) and their intermediate results are covered by dedicated tests.

## 13. Refund / Tax Reversal Preparation

`calculateTaxReversal` is proportional: `refundedGrossAmount` is expressed as a fraction of `original.customerGrossTotal`, and every other figure (customer base/IVA, and the professional-side commission/net-base/IVA/IRPF for an eventual professional credit note) is derived from that same ratio, with the IVA component always computed as `refundedGrossAmount - refundedTaxableBase` (never independently rounded) so partial refunds reconcile exactly to the cent. A full refund zeroes every "remaining" figure and exactly matches every "refunded" figure to the original. This is preparation data only — no credit-note document, no persistence, no Stripe/refund execution call; Module 77's `ExecuteRefundUseCase` was not modified.

## 14. Module 79 Integration Contract

Module 79 (invoicing/self-billing) should consume:

- `CalculateJobTaxBreakdownUseCase.execute(jobId, options?)` for a Job's full tax breakdown (customer invoice + professional self-billing invoice figures) — this is the one function that should back both the customer-facing invoice and the professional's self-billed invoice, so the two documents can never present inconsistent numbers.
- `calculateTaxReversal(original, refundedGrossAmount)` for a credit note's original/refunded/remaining IVA on both sides.
- Module 79 should **not** recompute commission, IVA, or the professional net base independently — every one of those numbers already exists on `MaestroYaTaxCalculationResult`.
- Module 79 will need to decide (this is explicitly out of Module 78's scope) whether the Stripe charge itself is updated to `customerGrossTotal` (IVA-inclusive) or whether IVA is handled purely as invoice/self-billing documentation on top of the existing pre-tax Stripe amount — see §3c and §18.

## 15. Database Changes

**None.** No `prisma/schema.prisma` changes, no new migration. Every figure Module 78 produces is derived at request time from `Quote`/`QuoteItem`/`CommissionRateRepository` — nothing new needs to be persisted for Module 78 itself to function, since it does not generate or store an invoice (that's Module 79). If Module 79 needs to persist `MaestroYaTaxCalculationResult` (e.g. onto an `Invoice` model), that migration belongs to Module 79, informed by which fields actually need to survive a request (at minimum: `customerTaxableBase`, `customerVatRateBps`, `customerVatAmount`, `customerGrossTotal`, `professionalNetBase`, `professionalVatAmount`, `professionalInvoiceGrossTotal`, `irpfWithholdingRateBps`, `irpfWithholdingAmount`) — this report intentionally does not speculate further than that list.

## 16. Tests Added

- `tests/unit/core/domain/maestroya-tax-calculation-service.test.ts` — 34 tests: canonical example (exact cent values for every field), no-double-taxation, commission-on-taxable-base-not-gross, IVA-after-correct-taxable-base, Scenario A, Scenario B (including a large customer-materials amount), zero materials / labour-only, materials-only, fully-zero job, negative/NaN/Infinity inputs, unsupported country, invalid IVA rate, valid reduced/super-reduced rates, invalid IRPF rate range, fractional-cent rounding, determinism, IRPF default and override, three separate integration checks against Module 64's commission engine (including the Scenario B exclusion), and 7 `calculateTaxReversal` tests (full/zero/partial refund, reconciliation identities, over-refund/negative-refund errors, zero-original edge case), plus a custom-tax-calculator-registry override test.
- `tests/unit/core/application/use-cases/financial/calculate-job-tax-breakdown.use-case.test.ts` — 5 tests: canonical Scenario A end-to-end via fakes, Scenario B end-to-end (including the malformed-quote defensive case from §3b), job-not-found, quote-not-found, and current-commission-rate-is-read-not-hardcoded.

Total: **39 new tests, all passing.**

## 17. Validation Results

Run from the repository root (`feature/module-78-iva-tax-integration` branch):

| Check | Command | Result |
|---|---|---|
| Module 78 targeted tests | `vitest run tests/unit/core/domain/maestroya-tax-calculation-service.test.ts tests/unit/core/application/use-cases/financial/calculate-job-tax-breakdown.use-case.test.ts` | **39/39 passed** |
| Related pre-existing financial tests (regression check) | `vitest run tests/unit/core/domain/tax-engine.test.ts tests/unit/core/domain/tax-calculator.test.ts tests/unit/core/domain/commission-calculation-service.test.ts tests/unit/core/domain/commission-policy.test.ts tests/unit/core/domain/module-71-commission-compatibility.test.ts` | **63/63 passed, zero regressions** |
| Typecheck | `tsc --noEmit` | **Passed, 0 errors** |
| Lint | `eslint` on every changed/created file | **Passed, 0 errors** (one pre-fix unused-var warning in the test file was fixed) |
| `prisma validate` | `npx prisma validate` | **Could not run** — fails with `403 Forbidden` fetching Prisma's engine binary checksum from `binaries.prisma.sh`. Pre-existing environment/network restriction, unrelated to Module 78 (no schema was touched). |
| Full unit suite (415 test files) | `vitest run tests/unit` | **Not completed** — see note below. |
| Production build | `next build` | **Not completed** — see note below. |

**Note on full-suite and build:** this session's remote shell caps every command at 45 seconds and does not support a process that outlives a single command (background/`nohup`/`setsid`-detached processes were confirmed killed the instant the invoking command returns — verified with a canary `sleep` test). The full 415-file unit suite and `next build` both exceed that budget on this codebase's size and did not finish within any single 45-second window; partial output up to the cutoff showed no failures. I did not claim these passed. **I recommend you run them yourself** (see §20) — nothing in Module 78 touches Prisma, Next.js routing, infrastructure adapters, or any file outside `domain/services/financial` and `application/use-cases/financial`, so the risk of an unseen regression is low, but "low risk" is not the same as "verified," and you should have the real numbers before merging.

## 18. Remaining Risks / Questions for Asesor

1. **§3c is the most important open question**: today, no IVA is actually charged to the customer or paid to the professional through Stripe. Module 78 gives you the correct numbers; someone needs to decide, with the gestor/asesor, whether Module 79 changes the Stripe charge amount itself (`customerGrossTotal` instead of the current pre-tax `Quote.totalAmount`) or whether IVA is handled entirely through the self-billing invoice on top of the existing pre-tax Stripe flow. This is a real, currently-live gap in production, not a theoretical one.
2. **§3b**: `CalculateJobCommissionBreakdownUseCase` (Module 64) does not check `materialsStrategy` at all. Module 78 defensively works around this in its own use case, but the underlying gap in Module 64/quote-creation validation still exists and could cause a real Module 64 commission figure to be wrong if a professional ever adds a priced `MATERIALS` item to a `CUSTOMER_PURCHASED` quote. Recommend closing this at the source (reject in `CreateQuoteUseCase`/`UpdateQuoteUseCase`) rather than relying on every future caller to filter it out the way Module 78 does.
3. `professionalVatRateBps` is computed using the same rate as the customer side (`customerVat.rateBps`), i.e. Module 78 assumes the professional's self-billing invoice always uses the same IVA rate category as the customer-facing supply. This is the standard/expected case (same underlying supply, same rate) but was not explicitly confirmed against the AEAT guidance cited in the spec — flagging for the asesor to confirm there is no scenario where these should differ.
4. `calculateTaxReversal`'s professional-side figures (`refundedCommissionAmount`, `refundedProfessionalNetBase`, etc.) are a **proportional estimate**, not necessarily what a real self-billing credit note would legally record line-by-line. Module 79 should treat these as a starting point for its own credit-note logic, not as the final legal figures, if the professional's original invoice covered more than one job/line item.
5. Full test suite and production build were not run to completion in this session (§17) — please run them before merging.

## 19. Production-Readiness Assessment

The Module 78 calculation layer itself — `calculateMaestroYaTaxBreakdown`, `calculateTaxReversal`, and `CalculateJobTaxBreakdownUseCase` — is production-ready: pure, deterministic, fully covered by tests against the spec's exact worked numbers, reuses every existing money/commission/tax primitive without duplication, introduces no schema changes, and does not alter any existing use case's behavior (verified by the zero-regression run in §17).

**Module 78 is ready for Module 79 to build on.** It is **not** a statement that MaestroYa's financial flow is fully IVA-correct end-to-end today — it explicitly is not (§3c) — because closing that gap requires a business decision (how IVA is actually collected/remitted) that is out of this module's scope and belongs to Module 79 plus a conversation with the gestor/asesor.
