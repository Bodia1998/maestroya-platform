# Module 125 — LEAD_V1 ServiceRequest Entry & Wiring — Report

Design/security detail: `MODULE_125_LEAD_V1_SERVICE_REQUEST_ENTRY_AUDIT.md`.

## Files changed
* `src/core/domain/repositories/service-request-repository.ts` — optional `flowVersion` on `CreateServiceRequestData`.
* `src/core/infrastructure/database/prisma/repositories/prisma-service-request-repository.ts` — writes `flowVersion` explicitly (`?? LEGACY_QUOTE_PAYMENT`).
* `tests/unit/prisma/lead-publication-preview-boundary-contract.test.ts` — the "nothing under src/app exposes lead workflows" check now allows only the two Module 125 entry files and requires them to avoid repositories/Prisma.

## Files added
* `src/core/application/use-cases/lead/create-lead-v1-service-request.use-case.ts`, `src/core/application/use-cases/lead/compose.ts`
* `src/app/(dashboard)/requests/lead-actions.ts`, `src/app/(dashboard)/dashboard/professional/leads/actions.ts`
* Tests: `tests/unit/core/application/use-cases/lead/create-lead-v1-service-request.test.ts`, `tests/unit/app/lead-v1-entry-actions.test.ts`, `tests/unit/core/infrastructure/database/prisma/repositories/prisma-service-request-repository-flow.test.ts`, `tests/unit/prisma/lead-v1-entry-boundary-contract.test.ts`
* The two MODULE_125 markdown files.
* Housekeeping: an empty stray file `tests/unit/_to_delete/app-lead-entry-actions.test.ts.tmp` (my mistake; delete permission was declined, so please remove `tests/unit/_to_delete/`).

## Flow summary
* Creation: `createLeadServiceRequestAction` → `CreateLeadV1ServiceRequestUseCase` → repository `create(..., flowVersion: LEAD_V1)` → Module 124 `CreateLeadUseCase` → Lead(DRAFT).
* LEAD_V1 enforcement: literal constant in the use case; client value stripped; explicit repository write; persisted value asserted in tests; static contract.
* Ownership: session user → CustomerProfile; no client ids trusted.
* Publication: `publishLeadAction` → `PublishLeadUseCase` (idempotent; CLOSED/EXPIRED/CANCELLED rejected).
* Preview: `getLeadPreviewsAction` / `getLeadPreviewAction` → Module 124 preview use cases (DTO unchanged).
* Composition root: `use-cases/lead/compose.ts`. Routes: none added (Server Actions only, matching the project).
* Authorization/validation: as in the audit. Financial isolation: ServiceRequest/Address/Lead writes only.
* Transaction: compensation to CANCELLED on Lead-creation failure (no cross-repo transaction exists).

## Tests executed (Linux VM; repo `node_modules` generated for macOS)
* Focused: `tests/unit/core/application/use-cases/lead`, `tests/unit/prisma`, new action/repository tests — all passed (130 tests across 14 files, plus the 8-test Module 125 contract re-run after fixing a broad check of mine). The only error is the pre-existing `tests/unit/prisma_probe.test.ts` unhandled `PrismaClientInitializationError` (linux-arm64 engine missing), unrelated to assertions.
* Regression slice: `unit/core/application/use-cases/lead-contact`, `unit/core/application/use-cases/payments`, `unit/core/application/services`, `unit/core/infrastructure/database`, `unit/app`, `integration/service-request`, `integration/quotes` — **100 files, 728 tests passed**.

## Quality gates
* `npx tsc --noEmit`: exit 0.
* `eslint` on all changed/added files and test folders: exit 0 (repo-wide `npm run lint` not run).
* `git diff --check`: exit 0.
* `npx prisma generate`: **not run** (schema unchanged; running it in this Linux VM would overwrite the macOS-generated client). Run locally if desired.
* Full `npm test` and `npm run test:integration:db` (real PostgreSQL): **not run** here (the full suite did not complete in the Module 124 VM; no DB available). Please run them locally.

## Migration status
None. No schema change.

## Unresolved decisions
Exclusive vs shared, default `maxBuyers`, slot reservation, price/formula, expiry duration, refund policy, company purchasing, fee invoice timing, affiliate rewards, unlocked contact fields, auto-publish on create, `publishedAt`.

## Known limitations
No UI consumer; no customer own-Lead read/list; compensation instead of atomic transaction; ~25 duplicated input-preparation lines; mocked/in-memory tests only; no git operations performed (the branch `feature/module-125/lead-v1-service-request-entry` was already checked out).

## Recommended next module
Module 126: customer Lead read/list surface, edit/cancel interplay, DB integration test for create→publish→preview, `publishedAt` decision.
