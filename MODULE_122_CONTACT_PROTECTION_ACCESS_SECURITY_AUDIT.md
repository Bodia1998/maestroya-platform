# Module 122 — Contact Protection & Access Security — AUDIT

Scope: backend boundary protecting customer contact data before the Lead Marketplace (Module 123+). Builds on Module 121 (`ServiceRequest.flowVersion`: `LEGACY_QUOTE_PAYMENT` | `LEAD_V1`), which is untouched.

Method: read the full relevant Prisma models (`User`, `Address`, `CustomerProfile`, `ServiceRequest`), Module 121 code, the Module 103 IDOR audit (authorization conventions), `rbac.ts`, the professional-facing discovery/quote use cases and repositories, and grepped `src/` for `email`/`phone`/address selects. Evidence is repository code, not assumptions. I did not open every one of the ~450 use-case files; the exposure grep (below) is the basis for "no other professional-facing contact path found".

## 1. Existing contact-data access paths

| Path | Caller | Returns | Flow | Contact exposed? | AuthZ |
|---|---|---|---|---|---|
| `GetAvailableServiceRequestsForProfessionalUseCase` + `PrismaServiceRequestDiscoveryRepository` | professional (session `userId`) | title, description, category, urgency, city, province, distance | legacy | **No** — select is `city/province/lat/lng` + `customer.userId`; lat/lng and `customerUserId` are used internally and mapped out before the DTO | use case derives professional from session |
| `GetServiceRequestForProfessionalUseCase` | professional | same summary | legacy | No | same + eligibility; ineligible = `NotFoundError` |
| `GetServiceRequestQuotesUseCase` | customer | quotes + professional public profile | legacy | Professional private email/phone/taxId deliberately excluded (existing doc + design) | ownership via `CustomerProfile` |
| Job views (`prisma-job-repository` customer/professional view selects) | job parties | counterparty **display name** only | legacy | Name only; no email/phone/address | `resolveJobActor` |
| Admin repositories/pages (`prisma-admin-repository`, verification repos) | ADMIN/SUPER_ADMIN | names + emails of users/owners | n/a | Yes, by design (admin back-office) | `requireRole` with fresh DB re-check (Module 82) |
| Company membership/invitation | company actors | member name/email | n/a | Yes, own-company data | `resolveCompanyActor` |
| GDPR export | the data subject | own data | n/a | own data | session |
| Chat/messages | conversation members | messages | legacy | Off-platform contact sharing is detected by existing `off-platform-detection-rules` (not changed here) | conversation membership |

No Server Action or API route returns a customer's email/phone/street address to a professional. (Module 103 independently reviewed all 40 action files and 18 routes for ownership.)

## 2. Identified leakage risks

1. **LEAD_V1 requests could appear in the legacy quote feed** (`findPublishedById` / `findPublishedByCategoryIds` had no flow filter). Once LEAD_V1 requests exist, a professional could read their raw title/description through the legacy feed and bypass any lead preview/pricing boundary. **Fixed** (query-level filter, see §7). Module 121 had flagged this as "ADAPT (Module 122)".
2. **No dedicated preview/contact DTO split existed** — future code could easily reuse a full customer/user projection. **Addressed** by whitelist DTO mappers + a single use case.
3. **Free-text leakage (open)**: `title`/`description` are customer-typed and may contain a phone number or email. This is not structurally preventable by a field whitelist. Existing `off-platform-detection-rules` could be reused for redaction in Module 123; not done here (would alter legacy-visible text).
4. Error-message leakage: existing `NotFoundError` embeds the id; the new boundary uses a fixed-message error with no id/reason.

## 3. Legacy contact-access behaviour (preserved)

Legacy professionals never receive customer contact fields via structured APIs; they communicate through in-platform chat. Job parties see the counterparty display name. None of this was changed. The only legacy-touching change is excluding `LEAD_V1` rows from the legacy feed; with every existing row `LEGACY_QUOTE_PAYMENT` by default, current behaviour is identical. No legacy "contact exception" was needed or created.

## 4. Future Lead Marketplace security boundary

```
LeadPreviewDTO  (safe fields; whitelist mapper)
LeadContactDTO  (private; only from GetLeadContactUseCase)
```
`GetLeadContactUseCase(userId, leadId)`: validate → active user → active professional profile → read authorization **facts** (no contact columns) → pure policy → only then `LeadContactReader.readContact` (explicit 8-column projection, not a customer aggregate) → whitelist DTO. Every failure throws the same `LeadContactAccessDeniedError` (fixed message, code `LEAD_CONTACT_ACCESS_DENIED`); the precise reason is logged (no PII).

## 5. Authorization model

`canProfessionalAccessLeadContact(facts, professionalProfileId)` — deny by default. Allowed only if: lead exists ∧ `flowVersion === LEAD_V1` ∧ `blocked === false` ∧ grant exists ∧ grant belongs to this professional ∧ grant state `CONFIRMED`. States `PENDING | REVOKED | INVALID` and any unknown value deny. The grant owner is re-checked in the policy even though the reader is already scoped to the professional (defence in depth against a faulty adapter).

## 6. DTO boundary

`src/core/application/dto/lead-contact.dto.ts`: `LeadPreviewDTO`, `LeadContactDTO`, mappers built from explicit field picks (no spread), and `PRIVATE_CONTACT_FIELD_NAMES` used by tests as a deep leak scanner. Preview never carries: email, phone, messaging ids, street/postcode, coordinates, `customer*`/`userId`. Preview exposes `leadId` only (not `serviceRequestId`). `LeadContactDTO` includes the street address but **not** raw coordinates (deliberate).

## 7. Repository / query boundary

- Ports (`application/ports/lead-contact-access.ts`): `LeadContactAuthorizationReader` (facts only) and `LeadContactReader` (private data; callable only from the use case — enforced by a static contract test).
- `PrismaServiceRequestDiscoveryRepository`: added `flowVersion: "LEGACY_QUOTE_PAYMENT"` to both `where` clauses. Selects unchanged. No migration; `ServiceRequest.flowVersion` exists from Module 121.
- No Prisma adapters were written for the ports (no Lead/LeadPurchase tables) — so today **no production path can reach `readContact`**.

## 8. API / server-action boundary

No route or action was added. Module 123 must expose contact only through a server action that calls `requireRole(PROVIDER…)`/`requireAuth()` for `userId` and passes it to `GetLeadContactUseCase` — the client supplies only `leadId`. Nothing relies on hidden UI, disabled buttons, client role checks or route naming.

## 9. Tests added

- `tests/unit/core/application/use-cases/lead-contact/get-lead-contact.use-case.test.ts` (23): authorized path and whitelist DTO; denial for empty user, customer, inactive user/professional, malformed/injection lead id (no lookups at all), missing lead, no grant, pending/revoked/invalid/unknown grant, other professional's grant, wrong flow, blocked, vanished contact; call-order proof that contact is read only after a positive decision; identical error for all denial reasons and no PII/id in error; preview leak tests including over-fetched Prisma-style nested `customer`/`address`.
- `tests/unit/prisma/contact-protection-boundary-contract.test.ts` (4): legacy feed filters flow at query level; feed select contains no contact columns; `LeadContactReader` used nowhere else; no `Lead`/`LeadPurchase` model introduced.

## 10. Unresolved dependencies for Module 123+

1. `Lead` and `LeadPurchase` models + migration; `Lead` must resolve to a `ServiceRequest` with `flowVersion = LEAD_V1`.
2. Prisma adapter for `LeadContactAuthorizationReader` mapping purchase status → `CONFIRMED | PENDING | REVOKED | INVALID` (everything not confirmed-and-paid, including failed/refunded/cancelled/disputed, must NOT map to `CONFIRMED`), scoped by `professionalProfileId`, setting `blocked` from restrictions/dispute freezes.
3. Prisma adapter for `LeadContactReader` selecting exactly the 8 `LeadContactRecord` columns (customer `User.name/email/phone`, `Address` fields) — never an aggregate.
4. Composition root + server action, and a preview feed using `toLeadPreviewDto`.
5. Decide free-text redaction for lead title/description (risk §2.3).
6. Optionally audit-log contact reads (not required by this module).
