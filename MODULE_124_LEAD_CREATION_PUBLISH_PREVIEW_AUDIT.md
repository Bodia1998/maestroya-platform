# Module 124 — Lead Creation, Publication & Safe Preview — Audit

## 1. Scope
Backend/domain/application/infrastructure only: `ServiceRequest (LEAD_V1) -> Lead (DRAFT) -> Lead (PUBLISHED) -> professional-safe Lead Preview`. No UI, routes, server actions, composition root, migration, pricing, purchase, payment or contact unlock.

## 2. Existing architecture inspected
* Schema: `Lead` (1:0..1 with ServiceRequest, `status`, `maxBuyers Int?`), `ServiceRequest.flowVersion`, `ServiceRequestStatus`.
* Use-case conventions: ports in `domain/repositories`, use cases in `application/use-cases/<area>`, session `userId` + customer ownership via `CustomerProfileRepository.findByUserId` (missing == not yours == `NotFoundError`), professional identity via `ProfessionalRepository.findByUserId` + `ProfessionalDiscoveryRepository.findCandidateById` (ACTIVE-only), errors extend `DomainError`.
* ServiceRequest lifecycle: MVP writes only PUBLISHED (open-equivalent) and CANCELLED; `service-request-state.ts` treats PUBLISHED as OPEN. **No flow-selection path exists yet**: `CreateServiceRequestUseCase` never sets `flowVersion`, so every request is LEGACY today. LEAD_V1 requests can only come from a future module (documented limitation).

## 3. Dependencies
* **Module 121**: `flowVersion` is the single source of truth; read via the existing `TransactionFlowReader` port (create) and the derived `LeadRecord.flowVersion` (publish). No legacy financial use case is imported or reachable.
* **Module 122**: reuses `LeadPreviewDTO` / `toLeadPreviewDto` unchanged (explicit whitelist) and `PRIVATE_CONTACT_FIELD_NAMES` in tests. Street address/postal code/coordinates/owner id/email/phone are protected; preview exposes only city/province. `GetLeadContactUseCase` is untouched and remains the only contact path.
* **Module 123**: `LeadRepository` extended with one method (`publish`); `LeadAlreadyExistsError`, `InvalidLeadFlowError` reused; unique constraint on `serviceRequestId` stays authoritative.

## 4. Lead creation (`CreateLeadUseCase`)
Order: customer owns request (else `NotFoundError`) -> flow must be LEAD_V1 (`InvalidLeadFlowError` for legacy) -> request status must be PUBLISHED and title/description/city non-blank (`ServiceRequestNotEligibleForLeadError`) -> existing Lead check (`LeadAlreadyExistsError`) -> `LeadRepository.create` (DRAFT, `maxBuyers` NULL). A concurrent duplicate loses on the DB unique constraint, mapped by the repository to `LeadAlreadyExistsError`. Creates only a Lead row.

## 5. Publication (`PublishLeadUseCase`, `LeadRepository.publish`)
Only DRAFT -> PUBLISHED. Already PUBLISHED returns the lead unchanged (idempotent, no write). CLOSED/EXPIRED/CANCELLED -> `LeadNotPublishableError`. Non-LEAD_V1 -> `InvalidLeadFlowError`. The request must still be PUBLISHED and complete. The write is `updateMany WHERE id AND status = 'DRAFT'`, so concurrent publishes cannot double-transition or resurrect terminal leads; a lost race is re-read and resolved to idempotent success or rejection. `maxBuyers` is never touched. Requires no payment, LeadPurchase, professional or quote.

## 6. Preview design
Separate read port `LeadPreviewRepository` + `PrismaLeadPreviewRepository` (the legacy quote feed is not modified and still filters `flowVersion = LEGACY_QUOTE_PAYMENT`). Visibility, enforced in the query: `lead.status = PUBLISHED AND request.flowVersion = LEAD_V1 AND request.status = PUBLISHED AND request.deletedAt IS NULL`. DRAFT/CLOSED/EXPIRED/CANCELLED never match, and a cancelled/expired underlying request hides the lead.
Use cases: `GetPublishedLeadPreviewsForProfessionalUseCase` (list) and `GetPublishedLeadPreviewUseCase` (single), applying the same eligibility as the legacy feed (category, radius, not own request).
**Preview fields (existing Module 122 DTO):** `leadId, title, description, categoryId, categoryName, urgency, city, province, distanceKm, createdAt` (= Lead.createdAt).
**Excluded:** email, phone, street/line2/postal code, coordinates, customer/user ids, `serviceRequestId`, status, maxBuyers, purchases/LeadPurchase, payment/Stripe/ledger ids, internal/admin fields.

## 7. Contact protection analysis
Coordinates and the owner's user id are selected internally (radius rule, own-request exclusion) and dropped by an explicit field pick before `toLeadPreviewDto`. The repository select is an explicit list (address: city/province/lat/lng; customer: userId only). Error messages are fixed text with only the caller-supplied id; the single preview returns the same `NotFoundError` for malformed id, unknown, invisible, own, or out-of-radius leads, so nothing reveals existence or purchases. Preview never reads or checks LeadPurchase, so a pending purchase cannot affect it and grants no contact (Module 122 policy unchanged).

## 8. Authorization
Creation/publication: the owning customer only (session `userId`). Preview: an ACTIVE `ProfessionalProfile` (existing identity); everyone else gets `[]` (list) or `NotFoundError` (single). No new roles; no company purchasing.

## 9. Repository changes
`LeadRepository.publish` (+ Prisma impl). New `LeadPreviewRepository` port and Prisma implementation. `prisma-lead-repository.ts` remains the only writer of `leads` (Module 123 contract test still holds).

## 10. Domain rules (`domain/services/lead.ts`)
`canPublishLead`, `assertLeadPublishable`, `LeadNotPublishableError`, `LEAD_ELIGIBLE_REQUEST_STATUS`, `assertServiceRequestEligibleForLead`, `ServiceRequestNotEligibleForLeadError(reason)`. Pure; no authorization or I/O. "Minimum information" = what ServiceRequest creation already requires (title, description, city); nothing invented.

## 11. Database
No schema change, no migration (contract test asserts none). `prisma generate` not required.

## 12. Tests
`lead-publication.test.ts` (rules), `lead-workflow.test.ts` (create/publish use cases), `get-published-lead-previews.test.ts` (preview use cases + deep leak scan), `prisma-lead-preview-repository.test.ts` and `prisma-lead-repository-publish.test.ts` (query filters, explicit select, status-conditional write, legacy-model tripwires), `lead-publication-preview-boundary-contract.test.ts` (static: no legacy financial/LeadPurchase/pricing/contact-path imports, legacy feed still LEGACY-only, nothing under `src/app`, no migration).

## 13. Security review
Every preview field was inspected through DTO, repository select, use-case mapping and error messages (see §6-7). Residual: description/title are customer free text and could contain a phone number or email typed by the customer; this is already true of the legacy feed and is not addressed here.

## 14. Explicitly excluded
Pricing/fee, LeadPurchase, slots, payments, Stripe, refunds, contact unlock, affiliate, legal text, UI, endpoints, composition root, automatic expiry, close/expire/cancel transitions, company purchasing.

## 15. Open business decisions (unchanged)
Exclusive vs shared; default `maxBuyers`; pending purchases reserving slots; repurchase after refund/revoke; lead pricing and formula; expiry duration; publication eligibility beyond existing rules; company purchasing; fee invoice timing; affiliate reward; exact contact fields unlocked. Extension points: `CreateLeadUseCase` (future pricing/maxBuyers), `PublishLeadUseCase` (future expiry).

## 16. Known limitations
* No creation path yields LEAD_V1 requests yet.
* No `publishedAt` column: preview `createdAt` is `Lead.createdAt`, not publication time (additive column is a candidate for a later module).
* Lead-publication does not auto-follow later changes: a request cancelled after publication simply stops matching the feed.
* Mocked-Prisma tests only; no real-PostgreSQL integration test for the conditional update.
* Publication/preview are not wired to routes or a composition root.

## 17. Recommended next module
Module 125: wire a composition root + server actions (customer create/publish, professional preview feed) and add a flow-selection path that produces LEAD_V1 requests, with an integration-db test; pricing/purchase stay later.
