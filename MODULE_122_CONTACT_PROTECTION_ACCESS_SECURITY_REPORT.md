# Module 122 — Contact Protection & Access Security — REPORT

Companion to `MODULE_122_CONTACT_PROTECTION_ACCESS_SECURITY_AUDIT.md`.

## 1. What was implemented
- Domain policy `canProfessionalAccessLeadContact` (deny by default) + `LeadContactAccessDeniedError` (single fixed-message error).
- Ports `LeadContactAuthorizationReader` / `LeadContactReader` (no implementations yet).
- `LeadPreviewDTO` / `LeadContactDTO` with whitelist mappers and `PRIVATE_CONTACT_FIELD_NAMES`.
- `GetLeadContactUseCase`: validate → actor → facts → policy → read contact → DTO.
- Legacy feed hardening: `PrismaServiceRequestDiscoveryRepository` now excludes `LEAD_V1` requests at query level.
- Audit and this report.

## 2. Files changed
Modified: `src/core/infrastructure/database/prisma/repositories/prisma-service-request-discovery-repository.ts`.

Created:
- `src/core/domain/services/lead-contact-access-policy.ts`
- `src/core/application/ports/lead-contact-access.ts`
- `src/core/application/dto/lead-contact.dto.ts`
- `src/core/application/use-cases/lead-contact/get-lead-contact.use-case.ts`
- `tests/unit/core/application/use-cases/lead-contact/get-lead-contact.use-case.test.ts`
- `tests/unit/prisma/contact-protection-boundary-contract.test.ts`
- the two `MODULE_122_*` markdown files

No schema change, no migration, no new dependency.

## 3. Tests
27 new tests (23 behavioural + 4 static contract), all passing. Regression runs (Vitest, in slices because my sandbox kills runs of about 3 minutes):

| Slice | Result |
|---|---|
| tests/integration | 71 files / 1010 tests |
| tests/unit/core/domain | 132 / 1289 |
| tests/unit/core/application (incl. new) | 147 / 1106 |
| tests/unit/core/infrastructure + i18n + regression | 165 / 1273 |
| tests/unit/app + presentation + shared + prisma (incl. new contract test) | 120 / 835 |
| middleware, next.config, prisma_probe | 3 / 34 |

Not run: Playwright e2e and `test:integration:db` (need browser / real Postgres).

## 4. Commands executed
`npm run lint` (clean) · `npm run typecheck` (clean, 0 errors) · `git diff --check` (clean) · `npx vitest run …` slices above · `npx prisma generate` — **failed in my sandbox** (403 downloading the Prisma query engine from binaries.prisma.sh); the schema is unchanged by this module, so the existing generated client was used. Please run `npx prisma generate` and `npm test` on your Mac for a clean single-run confirmation. I ran `git status` (read-only) — see Remaining risks about a stray lock file.

## 5. Intentionally NOT implemented
Lead / LeadPurchase entities, pricing, feed, purchase/Stripe lead fee, contact unlocking, Prisma adapters for the new ports, composition root, server action/route, redaction of free text, affiliate/invoicing/legal work, any migration, any legacy removal. No git add/commit/push/branch change.

## 6. Remaining risks
- The boundary is **unwired**: it is safe because nothing can reach private data, but it is only as strong as the Module 123 adapters (see prerequisites).
- Free-text title/description can still contain contact details typed by the customer.
- Policy correctness depends on the future adapter mapping every non-confirmed purchase state away from `CONFIRMED`; the policy fails closed on unknown values but cannot see the underlying payment state.
- No evidence from this module supports calling the system production-ready.
- **Possible stale `.git/index.lock`** (0 bytes) created when my sandbox ran `git status`; the sandbox cannot delete files. If git reports "index.lock exists", run `rm .git/index.lock` (no git process of yours should be running).

## 7. Exact prerequisites for Module 123
1. `Lead` + `LeadPurchase` models (additive migration); `Lead` → `ServiceRequest` with `flowVersion = LEAD_V1`.
2. `LeadContactAuthorizationReader` adapter: scoped by `professionalProfileId`; maps purchase status to `CONFIRMED | PENDING | REVOKED | INVALID` (only a confirmed, paid, non-refunded purchase → `CONFIRMED`); sets `blocked`; selects no contact columns.
3. `LeadContactReader` adapter: explicit 8-column select matching `LeadContactRecord`.
4. Composition root `makeGetLeadContactUseCase()` + server action taking only `leadId`, `userId` from the session.
5. Preview feed built with `toLeadPreviewDto`; extend the contract test to cover the new repository selects.
6. Decide redaction of free-text title/description.

Recommended next module: 123 — Lead & LeadPurchase domain model (no payments yet), providing prerequisites 1–3.
