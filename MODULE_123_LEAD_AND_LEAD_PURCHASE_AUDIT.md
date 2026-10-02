# Module 123 — Lead & LeadPurchase Domain & Persistence — Audit

Status: design/decision record. Companion: `MODULE_123_LEAD_AND_LEAD_PURCHASE_REPORT.md`.

## 0. Repository findings that drove the design

| Question | Finding | Decision |
|---|---|---|
| Existing Lead / purchase / opportunity concept? | None. Searches for `lead`, `opportunity`, `marketplace request` only hit Module 121/122 code (flow guard, contact policy/DTO/ports) and the legacy quote-request discovery repository. `QuoteStatus` / `Quote` is the legacy bid, not an opportunity. | New `Lead` / `LeadPurchase`; nothing reused or duplicated. |
| Money convention | `Decimal(10,2)` column + `currency String @default("EUR")` (Payment, Quote, …); domain/records carry a plain `number` (`Number(row.amount)`). No `Money` value object exists (the value-objects README lists it only as a future idea); no minor-unit integer convention for persisted prices. | Reuse exactly that shape. **No second money representation introduced.** |
| Professional identity | `ProfessionalProfile` (`@id uuid`, `userId @unique`). Module 122 authorizes by `professionalProfileId`; Quote uses `professionalProfileId`. Company accounts exist (`CompanyProfile`) as a separate party. | `LeadPurchase.professionalProfileId -> ProfessionalProfile`. Named `professionalProfileId` (not `professionalId`) to match repo + Module 122 vocabulary. Company purchasing deferred. |
| IDs | `String @id @default(uuid()) @db.Uuid`. | Same. |
| Tables / enums | `@@map("snake_plural")`, PascalCase enums with UPPER_SNAKE values, `onDelete: Restrict` for history-bearing FKs. | Same (`leads`, `lead_purchases`). |
| Layering | Domain pure rules in `domain/services`, ports in `domain/repositories` (plain string unions, no `@prisma/client`), Prisma impls in `infrastructure/database/prisma/repositories`, errors extend `DomainError`. `domain/entities` is used for stateful aggregates with their own transition tables (Payment, Backup…). | Pure rule modules + repository ports + Prisma repositories. No aggregate class: there are no transitions to encapsulate yet (see §5). |
| Partial unique index precedent | `partner_payouts_one_inflight_per_partner`, `professional_verifications_active_unique` — declared only in hand-written migration SQL, enforced via P2002 mapping. | Same pattern for the active-purchase guard. |
| Migration style | Hand-authored additive SQL with an explanatory header and rollback note (Module 121). | Same. |

## 1. Existing ServiceRequest architecture

`ServiceRequest` is the customer's request (title, description, address, budget, status, `flowVersion` from Module 121 defaulting to `LEGACY_QUOTE_PAYMENT`). Legacy children: `Quote`, `Job`, `Payment`, `Dispute`, … It stays the **only** source of the customer's request data. Module 123 adds one optional back-relation `lead Lead?` (no DB change on `service_requests`; the FK lives on `leads`).

## 2. Lead aggregate design

```
Lead
 ├── id                (uuid)
 ├── serviceRequestId  (uuid, UNIQUE, FK -> service_requests, RESTRICT)
 ├── status            LeadStatus, default DRAFT
 ├── maxBuyers         Int?  (NULL = buyer policy not configured)
 ├── createdAt / updatedAt
 └── flowVersion       DERIVED from ServiceRequest.flowVersion (not a column)
```

* **Thin by design.** No title/description/address/contact is copied. A Lead is the marketplace opportunity, not a request snapshot.
* **`flowVersion` is not stored.** Storing it would duplicate `ServiceRequest.flowVersion` and allow drift (a Lead saying `LEAD_V1` for a request that says otherwise). Instead:
  * **Write enforcement:** `PrismaLeadRepository.create` reads the request's `flowVersion` *in the same transaction* as the insert and throws `InvalidLeadFlowError` unless it is `LEAD_V1`; it also rejects missing / soft-deleted requests. It is the only writer of `leads` (static contract test).
  * **Read exposure:** `LeadRecord.flowVersion` is read from the request (typed as the full union, so an inconsistent link would surface and be denied by Module 122's `WRONG_FLOW`).
  * Residual risk: a raw-SQL insert bypassing the repository, or someone later mutating `ServiceRequest.flowVersion` of a request that already has a Lead. No code mutates `flowVersion` after creation today. A DB-level guard (trigger, or composite FK `(serviceRequestId, flowVersion) -> service_requests(id, flowVersion)` + CHECK) was considered and **deferred**: it cannot be validated without a Postgres instance in this module's environment and adds redundant storage; recommended as a hardening item for Module 124 if real-DB CI is available.
* **Maximum buyers is configurable, not chosen.** `maxBuyers` NULL means "not configured" — explicitly *neither* unlimited *nor* exclusive. Later modules set it (1 = exclusive, N = shared) with no schema change. DB CHECK: `maxBuyers IS NULL OR maxBuyers >= 1`. **No code or constraint encodes exclusivity** (no unique on `leadId` alone).

## 3. LeadPurchase design

```
LeadPurchase
 ├── id
 ├── leadId                 (FK -> leads, RESTRICT)
 ├── professionalProfileId  (FK -> professional_profiles, RESTRICT)
 ├── status                 LeadPurchaseStatus, default PENDING_PAYMENT
 ├── price                  Decimal(10,2)  — fee the professional pays MaestroYa
 ├── currency               String default "EUR"
 ├── confirmedAt / refundedAt / revokedAt   (nullable lifecycle timestamps)
 └── createdAt / updatedAt
```

* `price` = what the professional pays MaestroYa for lead access. **Not** the customer's service price, **not** the professional's quote. A LeadPurchase is not a `Payment`, creates no `Commission`/`Payout`/`Invoice`, and has no FK to any legacy financial table (schema + repository contract tests).
* Timestamps: only `confirmedAt` (access granted — Module 122/126), `refundedAt`, `revokedAt`. FAILED/CANCELLED are terminal states whose time is `updatedAt`; adding more would be speculative. No payment-intent / Stripe / invoice fields — Module 126 will add its idempotency keys.
* Domain validation (`assertValidLeadPurchaseAmount`): finite, `>= 0`, ≤ 2 decimals, ≤ 99,999,999.99, currency exactly `EUR`. DB CHECK `price >= 0` backs the sign rule. The currency stays a string column (repo convention) with the EUR rule in the domain so a later multi-currency decision needs no migration.

## 4. Relationships

* `ServiceRequest 1 ── 0..1 Lead` (`leads.serviceRequestId` UNIQUE). Existing requests need no Lead; legacy requests remain valid.
* `Lead 1 ── N LeadPurchase` (shared leads stay possible).
* `ProfessionalProfile 1 ── N LeadPurchase`.
* All FKs `ON DELETE RESTRICT` (history is never cascaded away).

## 5. Statuses

**LeadStatus**: `DRAFT` (default; not visible), `PUBLISHED`, `CLOSED`, `EXPIRED`, `CANCELLED`. `ServiceRequestStatus` already has `DRAFT/PUBLISHED/CANCELLED/EXPIRED`, so the set was kept: PUBLISHED/CLOSED are needed for the feed and for "no longer purchasable"; EXPIRED (time) and CANCELLED (withdrawn) are different causes with different reporting. **Transitions deliberately not implemented** (no update method exists): publish (Module 124), close/expire/cancel (later). 

**LeadPurchaseStatus**: `PENDING_PAYMENT` (default), `CONFIRMED`, `FAILED`, `CANCELLED`, `REFUNDED`, `REVOKED`. Each has a concrete reason: Module 122 needs PENDING/CONFIRMED/REVOKED/INVALID; a failed charge, an abandoned checkout and a refund are distinct payment outcomes later modules must tell apart; REVOKED is a platform action after payment. **Transitions deliberately not implemented** (Module 126+). `toLeadContactGrantState()` is the declared mapping contract for Module 122.

## 6. Money representation
See §0 and §3. Persisted `Decimal(10,2)`, domain `number` with 2-decimal validation, `EUR`. Conversion `Number(row.price)` is identical to `PrismaPaymentRepository`.

## 7. Indexes (final)

| Index | Why |
|---|---|
| `leads_serviceRequestId_key` (UNIQUE) | 1:0..1 invariant + `findByServiceRequestId` |
| `leads_status_createdAt_idx` | future feed: `WHERE status='PUBLISHED' ORDER BY createdAt` |
| `lead_purchases_leadId_status_idx` | per-lead buyer counting / confirmed lookups; leadId prefix also serves the FK |
| `lead_purchases_professionalProfileId_status_idx` | "my purchases" and per-professional lookups; also serves the FK |
| `lead_purchases_one_active_per_lead_professional` (UNIQUE, partial) | duplicate-purchase guard, see §8 |

Evaluated and **not** added: `Lead.flowVersion` (not a column — derived); standalone `leadId` / `professionalProfileId` indexes (redundant with the composite prefixes).

## 8. Constraints and the duplicate-purchase invariant

* UNIQUE `(leadId, professionalProfileId) WHERE status IN ('PENDING_PAYMENT','CONFIRMED')`. True under **any** buyer policy (exclusive or shared): a professional never has two in-flight-or-paid purchases of the same lead. Terminal rows are excluded so history is preserved and a retry after FAILED/CANCELLED is possible. The status list is mirrored by `ACTIVE_LEAD_PURCHASE_STATUSES` and a contract test asserts the two agree.
* **Deliberately not decided:** whether re-purchase after `REFUNDED` / `REVOKED` is allowed — a business rule for the purchase use case, not a certain DB invariant. A plain `UNIQUE(leadId, professionalProfileId)` was rejected: it would forbid legitimate retries.
* CHECKs: `price >= 0`; `maxBuyers IS NULL OR >= 1`.
* Prisma cannot express partial indexes/CHECKs → declared in migration SQL (existing precedent); violation is mapped from `P2002` to `DuplicateActiveLeadPurchaseError`.

## 9. Legacy-flow separation

* Migration creates two new tables and two enum types only; `service_requests`, `quotes`, `payments`, `commissions`, `payouts`, `invoices` are not altered (contract test asserts every `ALTER TABLE` targets only `leads`/`lead_purchases`).
* Legacy models have no relation to `Lead`/`LeadPurchase` (contract test).
* Lead repositories never touch legacy models (static test + Proxy tripwires in the repository unit tests: any access to `quote/payment/commission/payout/invoice` fails the test).
* A legacy (`LEGACY_QUOTE_PAYMENT`) request cannot receive a Lead. A Lead cannot be created via the legacy quote/payment use cases; Module 121 guards remain untouched and their tests are unchanged.

## 10. Module 122 integration boundary

* Not bypassed, not weakened. No `LeadContactAuthorizationReader` / `LeadContactReader` adapter is implemented, so **no production path can reach contact data** (a static test asserts no class implements either port).
* Information provided for the future adapter: `LeadRepository.findById` (existence + derived `flowVersion`), `LeadPurchaseRepository.findConfirmedByLeadAndProfessional(leadId, professionalProfileId)` (scoped to the professional), and `toLeadContactGrantState()` (only `CONFIRMED -> "CONFIRMED"`; `PENDING_PAYMENT -> "PENDING"`; `REVOKED -> "REVOKED"`; everything else, including unknown, `-> "INVALID"`).
* Repositories use explicit select lists; `LeadRecord`/`LeadPurchaseRecord` have no customer name/email/phone/address. No endpoint/action/page references the new repositories (static test).
* `PENDING_PAYMENT ≠ contact access`; `CONFIRMED` is only a *candidate* — `canProfessionalAccessLeadContact` still decides (tested: wrong flow and other professional's grant still deny).
* The Module 122 static test "does not introduce Lead / LeadPurchase tables yet" was a Module-123-expiring assertion; it was **replaced** (not deleted) by "Lead/LeadPurchase hold no customer contact columns". Every other Module 122 assertion is unchanged.

## 11. Unresolved business decisions (not decided here)

1. **Exclusive vs. shared leads / max buyers** (`Lead.maxBuyers` NULL until decided; also what a later module should do when it is NULL — recommended: treat as "not purchasable" until configured).
2. Re-purchase policy after `REFUNDED` / `REVOKED`.
3. Whether a PUBLISHED lead may be purchased while the buyer cap is reached by *PENDING* (unpaid) purchases (do pending purchases reserve a slot, and for how long?).
4. Company (CompanyProfile / member) purchasing and invoicing of the lead fee.
5. Lead expiry rules (relation to `ServiceRequest.expiresAt`) and who may cancel/close.
6. Free-text redaction of the request title/description in the preview (Module 122 risk §2.3).
7. Legal/tax treatment of the lead fee (IVA, invoicing) — to be confirmed with Spanish advisors.

## 12. Future dependencies

* **Module 124**: Lead creation workflow from a LEAD_V1 request, publish transition, Lead preview (safe fields), optional DB-level flow guard.
* **Module 125**: pricing engine → fills `LeadPurchase.price`.
* **Module 126**: purchase creation use case, payment initiation, Stripe idempotency (see below), confirmation, status transitions (+ `confirmedAt`), webhook handling.
* Module 122 adapters (authorization facts + contact reader) and the composition root / server action.
* **Required future invariant for Module 126:** purchase initiation, payment initiation and webhook confirmation must be idempotent per `(leadId, professionalProfileId)` and per external payment event: a repeated click must return the existing active purchase (never a second row — the partial unique index guarantees at most one), and a duplicated/late webhook must not re-confirm, double-count buyers, or resurrect a REVOKED/REFUNDED purchase. Confirmation must be a compare-and-set on status inside a transaction, together with the `maxBuyers` cap check.
