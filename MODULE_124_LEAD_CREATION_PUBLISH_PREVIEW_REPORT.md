# Module 124 — Lead Creation, Publication & Safe Preview — Report

Design and security analysis: `MODULE_124_LEAD_CREATION_PUBLISH_PREVIEW_AUDIT.md`.

## Files changed
* `src/core/domain/services/lead.ts` — publication rules, request-eligibility rule, `LeadNotPublishableError`, `ServiceRequestNotEligibleForLeadError`.
* `src/core/domain/repositories/lead-repository.ts` — `publish(id)` (atomic DRAFT -> PUBLISHED, `null` if nothing transitioned).
* `src/core/infrastructure/database/prisma/repositories/prisma-lead-repository.ts` — status-conditional `updateMany` implementing `publish`.

## Files added
* `src/core/application/use-cases/lead/create-lead.use-case.ts`, `publish-lead.use-case.ts`, `get-published-lead-previews.use-case.ts` (list + single preview).
* `src/core/domain/repositories/lead-preview-repository.ts`, `src/core/infrastructure/database/prisma/repositories/prisma-lead-preview-repository.ts`.
* Tests: `tests/unit/core/domain/services/lead-publication.test.ts`; `tests/unit/core/application/use-cases/lead/lead-workflow.test.ts`, `get-published-lead-previews.test.ts`; `tests/unit/core/infrastructure/database/prisma/repositories/prisma-lead-preview-repository.test.ts`, `prisma-lead-repository-publish.test.ts`; `tests/unit/prisma/lead-publication-preview-boundary-contract.test.ts`.
* `MODULE_124_LEAD_CREATION_PUBLISH_PREVIEW_AUDIT.md`, this report.

## Behavior
* **Domain:** only DRAFT -> PUBLISHED; CLOSED/EXPIRED/CANCELLED rejected; backing request must be PUBLISHED (existing "open" status) with non-blank title/description/city.
* **Application:** `CreateLeadUseCase` (owner, LEAD_V1 via `ServiceRequest.flowVersion`, open request, no duplicate, DRAFT, `maxBuyers` NULL); `PublishLeadUseCase` (owner, idempotent for PUBLISHED, race-safe); preview list/single use cases for ACTIVE professionals (category, radius, not own request).
* **Infrastructure:** status-conditional publish write; separate read repository filtering `PUBLISHED lead + LEAD_V1 + open, non-deleted request` at query level with an explicit select.

## Preview fields
`leadId, title, description, categoryId, categoryName, urgency, city, province, distanceKm, createdAt` (Module 122 `LeadPreviewDTO`, reused unchanged).

## Explicitly excluded
Email, phone, street/line2/postal code, coordinates, customer/user ids, `serviceRequestId`, status, `maxBuyers`, LeadPurchase data, payment/Stripe/ledger ids, internal/admin fields.

## Authorization
Create/publish: owning customer (session `userId`; others get the same `NotFoundError`). Preview: ACTIVE `ProfessionalProfile`; others get `[]` / `NotFoundError`. No new roles.

## Tests executed (this environment: Linux VM, repo `node_modules` built for macOS)
* Module 124 + related slice (`tests/unit/prisma`, lead domain/use-case/repository tests, excluding `prisma_probe.test.ts`): **16 files, 182 tests passed**.
* Regression slices: `unit/core/application/use-cases/payments` 62 passed; `unit/core/application/use-cases/lead-contact` 23 passed; `unit/core/application/services` 226 passed; `integration/quotes` 35; `integration/service-request` 30; `integration/geolocation` 2; `integration/payments` 4; `integration/financial` 85; `integration/job` 34 — all assertions passed.
* `integration/quotes`, `service-request` and `job` return exit 1 solely from an *unhandled* `PrismaClientInitializationError` (Query Engine for linux-arm64 missing; client generated for darwin-arm64) — same sandbox artefact documented in Module 123; no assertion failed.

## Quality gates
* `npx tsc --noEmit` (`npm run typecheck`): exit 0.
* `eslint` on all changed/added areas: exit 0. A repo-wide `npm run lint` was not run separately.
* `git diff --check`: exit 0.
* `npx prisma generate`: **not run** — schema is unchanged, and running it in this Linux VM would overwrite the macOS-generated client. Run it locally if you want it re-confirmed.
* **Full `npm test` was NOT completed**: a full `vitest run tests/unit` was started and ran >15 minutes with no completion in this VM, so it was stopped. Please run `npm test` locally. `npm run test:integration:db` (real PostgreSQL) was not run.

## Migration status
None. No schema change.

## Unresolved decisions
Exclusive vs shared, default `maxBuyers`, slot reservation, repurchase after refund/revoke, pricing, expiry duration, extra publication eligibility, company purchasing, fee invoice timing, affiliate amount, unlocked contact fields.

## Known limitations
* No path creates LEAD_V1 requests yet (`CreateServiceRequestUseCase` always yields LEGACY).
* No `publishedAt`; preview `createdAt` = `Lead.createdAt`.
* Mocked-Prisma tests only; not wired to routes/actions/composition root.
* Free-text title/description may contain contact details typed by the customer (same as the legacy feed).
* The git branch was already `feature/module-124/lead-creation-publish-preview`; no git write operations were performed.

## Recommended Module 125
Composition root + server actions for customer create/publish and the professional preview feed, a LEAD_V1 flow-selection path, an integration-db test for the conditional publish, and (separately) `publishedAt`.
