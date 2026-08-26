# Module 78 — Materials Validation Fix Report

## 1. Executive Summary

Phase 2's audit (`MODULE_78_AUDIT_MATERIALS_COMMISSION.md`) found a real gap: nothing stopped a `Quote` whose `materialsStrategy` is `CUSTOMER_PURCHASED` from also carrying a priced (`unitPrice > 0`) `MATERIALS`-category `QuoteItem`. Because Module 64's commission engine and Module 78's tax engine both key off `QuoteItem.category` alone — never `materialsStrategy` — such an item would be silently commissioned and taxed even though `CUSTOMER_PURCHASED` materials are, by design, never priced or billed by MaestroYa (`QuoteMaterial` has no price field at all).

This change closes that gap at the point every Quote mutation must already pass through — `CreateQuoteUseCase` and `UpdateQuoteUseCase` — by adding one new domain-layer assertion, `assertNoPricedMaterialsWhenCustomerPurchased`, called from both use cases immediately alongside the existing `assertValidMaterialsList` check. A DTO-layer mirror was added for fast client-side feedback, following the exact precedent already set by the sibling rule `requireMaterialsWhenCustomerPurchased`. Module 64's commission engine, Module 78's tax engine, and every other item on the do-not-touch list were left completely unmodified — this fix works entirely by preventing the invalid state from ever being persisted, so the commission/tax engines simply never see it.

## 2. Root Cause

`materialsStrategy` (on `Quote`) and `category` (on `QuoteItem`) are two independent fields with no cross-field invariant enforced between them anywhere in the codebase prior to this change. A caller could set `materialsStrategy: "CUSTOMER_PURCHASED"` and still submit a `QuoteItem` with `category: "MATERIALS"` and a nonzero `unitPrice`; both would be persisted as-is, and every downstream reader (commission, tax) would treat that item exactly like a legitimate `PROFESSIONAL_SUPPLIED` materials charge.

## 3. Existing Architecture Discovered

- **Two, and only two, write paths for `materialsStrategy` + `items`**: `CreateQuoteUseCase.execute()` and `UpdateQuoteUseCase.execute()`, in `src/core/application/use-cases/quotes/`.
- Both are reached exclusively through Server Actions in `src/app/(dashboard)/dashboard/professional/quotes/actions.ts` (`createQuoteAction` / `updateQuoteAction`), which parse the request through `createQuoteSchema` / `updateQuoteSchema` (`src/core/application/dto/quote.dto.ts`) before invoking the use case.
- There is **no API route** for quote creation/update — only the Server Actions above.
- `PrismaQuoteRepository` (infrastructure layer) does no business validation of its own; validation is centralized in domain services invoked by use cases, per the codebase's existing convention. `PrismaQuoteRepository.updateStatus()` never touches `items`/`materialsStrategy`, so it is not a bypass vector.
- `UpdateQuoteUseCase` always requires the **complete** `items` array on every update (there is no partial-item-mutation path) — confirmed by reading `UpdateQuoteFields`'s own doc comment and the use case body. This means a single validation call inside `UpdateQuoteUseCase.execute()`, after it resolves the effective `materialsStrategy` (`input.materialsStrategy ?? existing.materialsStrategy ?? DEFAULT_MATERIALS_STRATEGY`) and using `input.items`, correctly covers every update scenario: adding a priced item to an already-`CUSTOMER_PURCHASED` quote, and switching an existing quote's strategy to `CUSTOMER_PURCHASED` while it still carries priced materials.
- Sibling rule `requireMaterialsWhenCustomerPurchased` / `assertValidMaterialsList` already implements exactly this "DTO-layer fast-feedback mirror + domain-layer authoritative gate" pattern for a closely related invariant (materials list required when `CUSTOMER_PURCHASED`), confirming this is an architecture that intentionally uses defense-in-depth for this class of rule.
- `materials-procurement-rules.ts` is a dependency-free domain service (no Prisma/Next.js imports), the correct home for a pure business-rule check of this kind.

## 4. Exact Invariant Implemented

> If `Quote.materialsStrategy === "CUSTOMER_PURCHASED"`, no `QuoteItem` with `category === "MATERIALS"` may have `unitPrice > 0`.

`PROFESSIONAL_SUPPLIED` quotes are completely unaffected — a priced `MATERIALS` item is exactly what that strategy is for. A `MATERIALS` item with `unitPrice === 0` is allowed under `CUSTOMER_PURCHASED` (it contributes nothing to any commission/taxable base, since `amount = quantity * unitPrice`), matching the task's own wording of "priced MATERIALS item."

## 5. Exact Validation Boundary Chosen

Domain-layer authoritative check: `assertNoPricedMaterialsWhenCustomerPurchased(strategy, items)` in `src/core/domain/services/materials-procurement-rules.ts`, called from:
- `CreateQuoteUseCase.execute()` — immediately after the existing `assertValidMaterialsList(materialsStrategy, materials)` call, before persistence.
- `UpdateQuoteUseCase.execute()` — same position, using the resolved effective `materialsStrategy` and the full `input.items`.

DTO-layer mirror (UX only, not trusted for enforcement): `rejectPricedMaterialsWhenCustomerPurchased`, added as an additional `.superRefine()` on both `createQuoteSchema` and `updateQuoteSchema` in `src/core/application/dto/quote.dto.ts`, chained after the existing `requireMaterialsWhenCustomerPurchased` refinement.

## 6. Why This Is Correct

- It sits at the one place both mutation paths already converge, so it cannot be bypassed by any Server Action, direct use-case call, or future caller that goes through these use cases — see the Bypass Analysis below for the exhaustive check.
- It reuses the existing validation infrastructure (`materials-procurement-rules.ts`, the same file `assertValidMaterialsList` lives in) rather than introducing a second, parallel validation mechanism.
- It does not touch `category` semantics, `QuoteItem` pricing, or the commission/tax engines themselves — those remain strategy-agnostic exactly as before; the fix works purely by preventing the invalid combination from ever reaching them.
- The DTO mirror follows the codebase's own established defense-in-depth precedent for this exact class of rule, rather than inventing a new layering approach.

## 7. Bypass Analysis

| Path | Verdict |
|---|---|
| `createQuoteAction` (Server Action) → `CreateQuoteUseCase` | Protected — domain check runs inside the use case regardless of DTO outcome. |
| `updateQuoteAction` (Server Action) → `UpdateQuoteUseCase` | Protected — same. |
| Direct `CreateQuoteUseCase`/`UpdateQuoteUseCase` invocation (bypassing the Server Action / DTO entirely) | Protected — the domain check is inside the use case itself, not the DTO, so it runs unconditionally. |
| API route | None exists for quotes — not a vector. |
| Repository methods (`PrismaQuoteRepository.create` / `.update` / `.updateStatus`) called directly | Not protected in isolation (the repository does no business validation, matching this codebase's existing convention of centralizing rules in use cases) — but there is no code path in this application that calls these repository methods directly for a mutation without first going through the use case; this mirrors exactly how `assertValidMaterialsList` was already (and remains) enforced, so it introduces no new class of gap. |
| Strategy-switch on update | Protected — `UpdateQuoteUseCase` resolves the effective strategy and validates against the full resupplied `items` array on every update. |
| Adding a priced item to an existing `CUSTOMER_PURCHASED` quote | Protected — same call, since updates always resupply the complete items array (no partial-item mutation path exists). |
| Removing/replacing items | Protected — any change to `items` goes through the same full-array update path. |

## 8. Exact Files Changed

1. `src/core/domain/errors/domain-error.ts` — added `PricedMaterialsNotAllowedError` class.
2. `src/core/domain/services/materials-procurement-rules.ts` — added `PricedQuoteItemInput` interface and `assertNoPricedMaterialsWhenCustomerPurchased` function; updated import.
3. `src/core/application/use-cases/quotes/create-quote.use-case.ts` — added call to `assertNoPricedMaterialsWhenCustomerPurchased`; updated import.
4. `src/core/application/use-cases/quotes/update-quote.use-case.ts` — added call to `assertNoPricedMaterialsWhenCustomerPurchased`; updated import.
5. `src/core/application/dto/quote.dto.ts` — added `rejectPricedMaterialsWhenCustomerPurchased` refinement, chained onto `createQuoteSchema` and `updateQuoteSchema`.
6. `tests/integration/materials/materials-procurement-flow.test.ts` — added 7 new integration tests (4 create-path, 3 update-path) plus supporting fixtures; updated import.
7. `tests/unit/core/domain/services/materials-procurement-rules.test.ts` — added 6 new unit tests for `assertNoPricedMaterialsWhenCustomerPurchased`; updated imports.

## 9. Files Intentionally Not Changed

- `CommissionCalculationService`, `commission-policy.ts`, all affiliate commission logic — unmodified, per the do-not-touch list; commission calculation still reads only `QuoteItem.category`, unaware of `materialsStrategy`, exactly as before.
- `maestroya-tax-calculation-service.ts`, `calculate-job-tax-breakdown.use-case.ts` — unmodified; Module 78's tax logic unaffected.
- Payment execution, Stripe integration, Stripe Connect, Module 76 payout execution, Module 77 refund/dispute logic — unmodified, out of scope.
- Prisma schema — unmodified; no migration required, since this is purely an application/domain-layer input validation rule.
- `PrismaQuoteRepository` — unmodified; consistent with the codebase's convention of not duplicating business validation into the infrastructure layer.

## 10. Tests Added/Modified

**Integration (`tests/integration/materials/materials-procurement-flow.test.ts`)** — new describe blocks:
- *Create path* (4 tests): rejects `CUSTOMER_PURCHASED` + priced `MATERIALS` item (with a persistence-bypass proof: `repos.quotes.quotes.size === 0` after rejection); accepts `CUSTOMER_PURCHASED` + unpriced (`unitPrice: 0`) `MATERIALS` item; accepts `PROFESSIONAL_SUPPLIED` + priced `MATERIALS` item unchanged (asserts `totalAmount === 400`); accepts `CUSTOMER_PURCHASED` with no `MATERIALS` items at all.
- *Update path* (3 tests): rejects switching an existing `PROFESSIONAL_SUPPLIED` quote to `CUSTOMER_PURCHASED` while retaining priced `MATERIALS` items (and confirms the persisted quote is unmutated by the rejected call); rejects adding a priced `MATERIALS` item to an existing `CUSTOMER_PURCHASED` quote; confirms a normal `PROFESSIONAL_SUPPLIED` update with priced materials still works unchanged.

**Unit (`tests/unit/core/domain/services/materials-procurement-rules.test.ts`)** — new describe block, 6 tests directly against `assertNoPricedMaterialsWhenCustomerPurchased`: no-throw for `PROFESSIONAL_SUPPLIED` + priced materials; throws `PricedMaterialsNotAllowedError` for `CUSTOMER_PURCHASED` + priced materials; no-throw for `CUSTOMER_PURCHASED` + unpriced materials; no-throw for `CUSTOMER_PURCHASED` + no materials items; no-throw for an empty items list; no-throw when an item's `category` is omitted (defaults to `LABOR`, not accidentally triggering the rule).

## 11. Test Results

- `npx vitest run tests/unit/core/domain/services/materials-procurement-rules.test.ts tests/integration/materials/materials-procurement-flow.test.ts` — **47/47 passed** (26 unit + 21 integration).
- `npx vitest run tests/unit/core/domain/commission-calculation-service.test.ts tests/unit/core/domain/commission-policy.test.ts tests/unit/core/domain/maestroya-tax-calculation-service.test.ts tests/unit/core/application/use-cases/financial/calculate-job-tax-breakdown.use-case.test.ts` — **72/72 passed**, confirming Module 64's commission tests and Module 78's own tax tests are completely unaffected by this change (in particular, `PROFESSIONAL_SUPPLIED` + priced `MATERIALS` still produces the exact same commission and tax figures as before — no test in these files was modified).
- Partial full-suite run (`npx vitest run --reporter=dot`, time-boxed): 12 test files observed to complete before the run was cut off by the tool's own per-command execution cap (not a test failure) — **zero failures observed** in every file that did complete, including `tests/integration/quotes/quote-flows.test.ts` (26 tests), `tests/integration/financial/payout-readiness-flows.test.ts` (24 tests), `tests/integration/materials/materials-procurement-flow.test.ts` (21 tests), `tests/integration/admin/admin-flows.test.ts` (40 tests), and `tests/unit/core/infrastructure/config/env.test.ts` (75 tests). A second time-boxed attempt scoped to `tests/unit` alone also completed 12 files with zero failures before being cut off by the same execution-time cap. **I could not get the complete `npm test` suite to finish within a single tool invocation in this environment** (each shell call in this session is hard-capped at well under a minute, and the full suite takes longer than that to enumerate and run) — I am reporting this honestly rather than claiming the full suite passed. Every test file directly relevant to this change (materials procurement, quotes, commission, tax) was run to completion and passed.

## 12. Typecheck Result

`npx tsc --noEmit` — **passed, zero errors**, run twice: once after the five production-code edits, once again after the two test-file edits (final state).

## 13. Lint Result

`npx eslint` run explicitly against all 7 changed files — **passed, zero errors/warnings, zero output**.

## 14. Build Result

`npm run build` (`next build`) was attempted, time-boxed to this session's per-command execution cap. The build had only reached the "Environments" banner and had not yet completed compilation when the cap was hit — **it did not finish within the available window, and I am not claiming it passed**. Given that `tsc --noEmit` passed cleanly across the whole codebase and every relevant test suite passed, I have no evidence of a build-breaking issue, but this is not the same as a completed `next build` and should not be represented as one.

## 15. Prisma Generation

Not run. No Prisma schema, migration, or generated-client-consuming code was touched by this change — the fix is a pure application/domain-layer validation addition — so Prisma generation is not relevant here. (Prior phases already established that `prisma generate` fails in this sandbox with a `403` from `binaries.prisma.sh`, an unrelated, pre-existing environment/network restriction.)

## 16. Remaining Risks

- The full `npm test` suite and `npm run build` could not be run to completion in this environment (see §11, §14); while every targeted and directly relevant test passed and typecheck/lint were both clean, this is not an unconditional guarantee that no unrelated part of the codebase is affected.
- The repository-layer bypass path noted in §7 (calling `PrismaQuoteRepository` directly, outside any use case) is not itself protected by this change — but this is an existing, unchanged characteristic of the codebase's validation architecture (the same is already true of `assertValidMaterialsList`), not a new gap introduced here.

## 17. Confirmation: No Git Commands Executed

No `git` command of any kind — including read-only commands such as `git status`, `git diff`, `git log`, or `git branch` — was executed at any point during this task. All file identification and verification was performed exclusively with `find`, `ls`, `grep`, `cat`, `python3`, and my own record of every edit made.

## 18. Confirmation: Changes Remain Unstaged and Uncommitted

No `git add`, `git commit`, or any other staging/commit command was executed. The 7 changed files (§8) exist only as working-directory modifications, as verified by `ls -la` timestamps immediately after the edits (all showing the current session's edit times, e.g. `2026-08-26 15:0x:xx`). No commits were created and no branches were modified.
