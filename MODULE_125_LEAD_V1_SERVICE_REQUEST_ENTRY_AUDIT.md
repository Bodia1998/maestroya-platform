# Module 125 — LEAD_V1 ServiceRequest Entry & Application Wiring — Audit

## Scope
Make the flow reachable through the existing architecture: Customer → create LEAD_V1 ServiceRequest → Lead(DRAFT) → explicit publish → professional Lead Preview. Wiring/entry only: no pricing, LeadPurchase, payment, contact unlock, affiliate, legal or UI work. Modules 121–124 are reused, not rewritten.

## Existing ServiceRequest architecture (inspected)
* `CreateServiceRequestUseCase(serviceRequests, customerProfiles, categories, geocoding)`; identity = session `userId` from `requireAuth()`; CustomerProfile resolved lazily via `findOrCreateByUserId`; validation = `createServiceRequestSchema` (zod) in the Server Action; repository `create` wrote no `flowVersion` (DB default LEGACY).
* Composition = per-module `compose.ts` plain factory functions over `new PrismaXRepository()`; entry points = Server Actions in `src/app/(dashboard)/**/actions.ts` (auth → zod → anti-abuse → one use case → `localizeActionError`). Professional authorization = the use case resolves an ACTIVE ProfessionalProfile from the session user (no role guard in the page/action).
* No cross-repository transaction abstraction exists.

## Legacy flow behavior
Unchanged. `CreateServiceRequestUseCase` and `requests/actions.ts` are not modified and contain no flow logic (static test enforces). The repository now writes `flowVersion` explicitly as `data.flowVersion ?? LEGACY_QUOTE_PAYMENT`, i.e. the same value the DB default produced.

## LEAD_V1 creation architecture
* `ServiceRequestRepository.create` data gains an optional `flowVersion` (smallest explicit abstraction; optional so every existing fake compiles).
* New `CreateLeadV1ServiceRequestUseCase` (`use-cases/lead/`): same validation/coordinate rules as the legacy use case (duplicated ~25 lines on purpose to leave the legacy class untouched), passes the literal `LEAD_FLOW_VERSION`, then calls Module 124's `CreateLeadUseCase`. Returns `{ serviceRequest, lead }`.
* Publication stays a separate explicit step: `PublishLeadUseCase` (Module 124, unchanged).

## Authorization model
* Owner = session user → CustomerProfile. `userId`, `customerId`, `ownerId`, `flowVersion` in the payload are stripped by the zod schema and never read by the use case/actions.
* Create-Lead / publish ownership checks are Module 124's (`findByUserId` → request.customerId; missing and not-yours both `NotFoundError`, no probing). The ownership check precedes Lead creation; the `leads.serviceRequestId` UNIQUE constraint remains authoritative.
* Preview: Module 124 use cases (ACTIVE professional from session; others get `[]`/NotFound). No new roles.

## Module 124 integration / composition root
`use-cases/lead/compose.ts` (new, same convention as other compose files): `makeCreateLeadUseCase`, `makeCreateLeadV1ServiceRequestUseCase`, `makePublishLeadUseCase`, `makeGetPublishedLeadPreviewsForProfessionalUseCase`, `makeGetPublishedLeadPreviewUseCase`. No container/locator/global state beyond module-level repository instances like the other roots. It does not use the legacy `transactionFlowGuard` (that is legacy-financial wiring); it uses `PrismaTransactionFlowReader` directly, as Module 124 requires.

## Server action changes
* `src/app/(dashboard)/requests/lead-actions.ts`: `createLeadServiceRequestAction(formData)` (auth, zod, `assertNotBlocked` + `SERVICE_REQUEST_CREATE_BY_USER` rate limit as the legacy action) and `publishLeadAction(leadId)` (uuid-validated).
* `src/app/(dashboard)/dashboard/professional/leads/actions.ts`: read-only `getLeadPreviewsAction()` / `getLeadPreviewAction(leadId)` returning Module 122's `LeadPreviewDTO` unchanged.
* Actions hold no business rules and import no repositories. Error fallbacks reuse existing i18n keys (`customer.requests.errors.*`); no translation files changed.

## Transaction boundary
ServiceRequest + Address creation is already two writes in the legacy path and Lead creation must not be re-implemented, so a single DB transaction was not possible without a new abstraction (forbidden). Instead: if Lead creation fails, the new request is compensated to `CANCELLED` (existing `updateStatus`) and the original error rethrown. Residual risk: if the process dies between the two steps, an open LEAD_V1 request without a Lead can exist; it is invisible to the legacy feed and the professional preview (no Lead), and the customer-facing Lead-create use case can attach one. Documented as a known limitation.

## Validation
Existing `createServiceRequestSchema` (unchanged) + the use case's budget/category checks. No fields made mandatory beyond today's.

## Security analysis
* Authorization/ownership: session-derived; cross-customer create/publish tested (NotFound, Lead stays DRAFT).
* flowVersion tampering: client value stripped by schema, ignored by use case, literal constant asserted by static test; persisted value asserted in tests (use case + repository).
* Contact exposure: preview path unchanged; end-to-end test scans the serialized preview for contact keys, coordinates, owner id, street, postal code, serviceRequestId, purchase.
* Legacy leakage: LEAD_V1 excluded from legacy feed (Module 121/124 tests green); legacy requests get no Lead and no preview.
* Financial side effects: entry code imports no quote/payment/commission/payout/invoice/affiliate/stripe/pricing/LeadPurchase modules (static test); only ServiceRequest, Address and Lead are written.
* Error leakage: not-found and not-owned are indistinguishable.

## Legacy regression protection
Repository test (legacy default explicit), static contracts (legacy use case/action flow-agnostic; legacy financial use cases do not import lead use cases; only the LEAD_V1 use case selects LEAD_V1), plus Module 121–124 suites green.

## Database changes
None. No migration, no `publishedAt`.

## Tests
See the implementation report.

## Explicit exclusions
Pricing, fee calculation, quality score, LeadPurchase, Stripe/payments/refunds/disputes, contact unlock, maxBuyers enforcement, expiry automation, affiliate, legal documents, marketplace UI, legacy removal.

## Known limitations
* No UI calls the new actions yet; there is no listing of the customer's own Leads.
* Compensation (not atomic transaction) between request and Lead creation.
* Title/description are free text and may contain contact details typed by the customer (as in legacy).
* Mocked-Prisma/in-memory tests only; no real-DB integration test was run.
* ~25 lines of input preparation are duplicated from the legacy use case.

## Unresolved business decisions (left open)
Exclusive vs shared Leads; default `maxBuyers`; whether pending purchases reserve slots; Lead access price/formula; Lead expiry duration; refund policy; company purchasing; Lead fee invoice timing; affiliate reward structure; contact fields unlocked after purchase; whether creation should auto-publish; `publishedAt`.

## Recommended next module
Module 126: customer-facing Lead surface (own-Lead read/list, request-edit/cancel interplay with Lead status) and an integration-db test for create→publish→preview and the compensation path; `publishedAt` decision. LeadPurchase/pricing remain later.
