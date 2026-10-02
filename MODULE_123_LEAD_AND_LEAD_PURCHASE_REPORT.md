# Module 123 — Lead & LeadPurchase Domain & Persistence — Report

Design rationale and decisions: see `MODULE_123_LEAD_AND_LEAD_PURCHASE_AUDIT.md`.

## 1. Implementation

* New persistence: `Lead` (1:0..1 with ServiceRequest) and `LeadPurchase` (N per Lead, one professional each), enums `LeadStatus` and `LeadPurchaseStatus`.
* `flowVersion` is **derived** from `ServiceRequest.flowVersion`, not stored. The `Lead -> LEAD_V1` invariant is enforced in `PrismaLeadRepository.create` (same transaction as the insert), the only writer of `leads`.
* Money reuses the repo convention (`Decimal(10,2)` + `currency` default `EUR`, domain `number`); no new Money type.
* `maxBuyers Int?` is a configurable buyer rule; NULL = not configured. No exclusivity/shared policy is encoded.
* Domain rules: `domain/services/lead.ts`, `domain/services/lead-purchase.ts` (statuses, validation, errors, `toLeadContactGrantState` mapping for Module 122).
* Ports: `LeadRepository` (create, findById, findByServiceRequestId), `LeadPurchaseRepository` (create, findById, findActiveByLeadAndProfessional, findConfirmedByLeadAndProfessional). No status-update methods, no use cases, no composition root, no endpoints.

## 2. Files changed

Modified: `prisma/schema.prisma` (+2 enums, +2 models, 2 back-relation fields), `tests/unit/prisma/contact-protection-boundary-contract.test.ts` (one expiring Module 122 assertion replaced — see audit §10).

Added:
* `prisma/migrations/20261002000000_add_module_123_lead_and_lead_purchase/migration.sql`
* `src/core/domain/services/lead.ts`, `lead-purchase.ts`
* `src/core/domain/repositories/lead-repository.ts`, `lead-purchase-repository.ts`
* `src/core/infrastructure/database/prisma/repositories/prisma-lead-repository.ts`, `prisma-lead-purchase-repository.ts`
* `tests/unit/core/domain/services/lead.test.ts`, `lead-purchase.test.ts`
* `tests/unit/core/infrastructure/database/prisma/repositories/prisma-lead-repository.test.ts`, `prisma-lead-purchase-repository.test.ts`
* `tests/unit/prisma/lead-marketplace-schema-contract.test.ts`
* `MODULE_123_LEAD_AND_LEAD_PURCHASE_AUDIT.md`, this report

## 3. Migration

`20261002000000_add_module_123_lead_and_lead_purchase` — hand-authored, purely additive: 2 enum types, 2 tables, 4 indexes, 3 RESTRICT foreign keys, CHECKs (`price >= 0`, `maxBuyers IS NULL OR >= 1`) and a partial unique index `lead_purchases_one_active_per_lead_professional` on `(leadId, professionalProfileId) WHERE status IN ('PENDING_PAYMENT','CONFIRMED')`. No existing table is altered. Rollback: drop the two tables, then the two types. **Not applied to any database** (none available in this environment).

## 4. Tests added (all executed, all passing)

* Domain: Lead statuses, `LEAD_V1` invariant (legacy/unknown rejected), `maxBuyers`; LeadPurchase statuses, price/currency validation, active-status set.
* Repositories (mocked Prisma, legacy models as tripwires): creation, LEAD_V1-only, missing/deleted request, one-Lead-per-request (P2002), duplicate active purchase (P2002 mapping), no `flowVersion` write, explicit select / no contact fields, unknown status rejection, Decimal mapping.
* Security (Module 122 boundary): PENDING_PAYMENT and every non-CONFIRMED status denied by the policy; CONFIRMED still denied on wrong flow / other professional; no adapter implements the Module 122 ports; no endpoint references the repositories; Lead/LeadPurchase have no contact columns.
* Legacy protection: migration touches only new tables; legacy models have no relation to Lead; repositories never touch quote/payment/commission/payout/invoice; legacy flow tests re-run unchanged.
* Schema/migration contract: enum parity with domain, 1:0..1 unique, RESTRICT FKs, partial index status list equals `ACTIVE_LEAD_PURCHASE_STATUSES`, no unique on `leadId` alone (no exclusivity encoded).
* **Not tested:** the migration against a real PostgreSQL (partial index, CHECKs, FK behaviour, P2002 under real concurrency) — no database was available.

## 5. Commands actually executed

Environment note: the repo's `node_modules` was installed on macOS (darwin-arm64); the sandbox is Linux with no access to Prisma's engine downloads (403). Consequently:

* `git diff --check` — executed in the repo: clean.
* `npx prisma validate` / `npx prisma generate` — **could not run** (engine download blocked). Substitutes: (a) the schema was validated with Prisma 6.19's own schema validator (`@prisma/prisma-schema-wasm@6.19.0-33`) — **VALID**; (b) in a *throwaway copy* of the project, `prisma generate --no-engine` produced the client types. The repo's own `node_modules/.prisma/client` was **not** regenerated — **you must run `npx prisma generate` locally.**
* `npm run typecheck` (`tsc --noEmit`) — executed in that throwaway copy with the regenerated types (needed a temporary `paths` mapping there only): **exit 0**.
* `npm run lint` (`eslint .`) — executed in the throwaway copy: **exit 0, no output**.
* `npx vitest run` slices executed in the repo: Module 123 tests + `tests/unit/prisma`, `flow-boundary`, `lead-contact`, `tests/unit/core/domain/services/lead*` (146/146 passed); `tests/unit/core/application/use-cases/{payments,invoicing,financial}` (62 + 82 + 5 passed); `tests/integration/{quotes,job,payments,financial,service-request}` (35, 34, 4, 85, 30 passed).
* **Full `npm test` was NOT completed** (an attempt exceeded the sandbox time limit; the last attempt was cancelled). Some runs report `exit=1` solely because of an *unhandled* `PrismaClientInitializationError` ("could not locate the Query Engine for linux-arm64") raised by tests that import the real client (e.g. the existing `tests/unit/prisma_probe.test.ts`, `tests/integration/quotes/quote-flows.test.ts`); every test assertion in those files passed. This is a sandbox artefact, not caused by this module, but please confirm with a normal local `npm test`.
* `npm run test:integration:db` (real PostgreSQL) — not run.

## 6. Intentionally deferred

Pricing engine; lead creation workflow/use cases and publication/feed; Lead status transitions; LeadPurchase creation use case, status transitions and payment idempotency; Stripe PaymentIntent/webhooks/confirmation; refunds; disputes; contact unlocking and the Module 122 adapters/composition root/server action; affiliate; invoicing of the lead fee; company purchasing; DB-level (trigger/composite FK) flow guard; legal integration.

## 7. Known limitations

* Migration and partial index unverified on real PostgreSQL (see §4).
* `Lead -> LEAD_V1` is enforced at the application write path, not by a DB constraint; raw SQL or a later mutation of `ServiceRequest.flowVersion` could bypass it (audit §2).
* Unique guard covers only PENDING_PAYMENT/CONFIRMED; re-purchase after REFUNDED/REVOKED is unrestricted at DB level.
* `maxBuyers` is stored but not enforced anywhere yet.
* Repository tests use a mocked Prisma client; no integration-db test was added.
* This is a persistence foundation only — **not production-ready as a feature** and nothing in it is wired to any route.

## 8. Prerequisites for Module 124

1. Locally run `npx prisma generate`, apply the migration to a dev DB, and run `npm run lint`, `npm run typecheck`, `npm test` (and ideally add an integration-db test for the partial index and checks).
2. Decide exclusive vs. shared leads / `maxBuyers` default and whether NULL blocks purchasing.
3. Decide Lead lifecycle rules (publish/close/expire/cancel) and who may trigger them.
4. Decide whether to add the DB-level flow guard.
5. Module 122 adapters remain to be written once the Lead preview/feed exists.
