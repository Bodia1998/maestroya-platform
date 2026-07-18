# Domain Model

Every model in `prisma/schema.prisma`, explained, plus the validation
results from the Phase 1 review pass.

## Update (seed phase)

Four more reference tables were added after the initial review below:
`Country`, `Province`, `City`, `PlatformSetting` — needed to seed
Spain/Valencia/Gandia and platform settings, which had no representable
target in the original 26+2 model set. See their entries under
"Reference data" below. `prisma/seed.ts` also now creates Admin and
Support bootstrap accounts (User + UserRole, no password — see the
"Known open design question" note at the bottom).

One thing this update could **not** independently verify: the compound
unique key names used in `seed.ts` (`countryId_name`, `provinceId_name`,
`userId_roleId`) rely on Prisma's default naming convention for
`@@unique([a, b])` — no `@prisma/client` was ever generated in this
environment to check property access against, so this is a well-founded
assumption, not a confirmed one. `npx prisma generate` will catch it
immediately (a TypeScript error on the `where` clause) if wrong.

## Validation status

**No network access was available in the environment this schema was
built in**, so the actual Prisma engine (`prisma validate`, `generate`,
`migrate dev`) could not be run. What follows is what a careful manual +
scripted static review can and can't confirm — treat `npx prisma migrate
dev` as the real, authoritative check once you have this locally.

Checked and clean:
- **Brace/structure balance** — no syntax truncation.
- **All 61 relations** — every scalar FK has a matching reverse field on
  the other model; no missing back-relations.
- **Relation naming** — every model pair with more than one relation
  between them (`User`↔`Dispute`, `User`↔`CompanyProfile`, etc.) has
  explicit, consistently-matched `@relation("Name")` strings; no
  ambiguous-relation errors expected.
- **Enum references** — every field typed with an enum resolves to one
  of the 27 declared enums; no typos found.
- **Field type resolution** — every model field resolves to a Prisma
  scalar, a declared model, or a declared enum (scripted check).
- **Auth.js compatibility** — `User`/`Account`/`Session`/
  `VerificationToken` keep the exact field names/shapes the
  `@auth/prisma-adapter` requires; only change was id generation
  (`cuid()` → `uuid()`), which the adapter doesn't care about.
- **TypeScript syntax** — `seed.ts` and the full `src/core` domain layer
  compile with zero errors in isolation (the domain layer has zero
  third-party dependencies, so this result is trustworthy, not just
  "no errors because modules were missing").

Fixed during this pass:
- **11 foreign-key columns had no supporting index**: `User.preferredLanguageId`,
  `ServiceRequest.addressId`, `Quote.submittedByUserId`,
  `Appointment.addressId`, `Review.reviewerId`, `Payment.quoteId`,
  `Refund.requestedByUserId`, `VerificationDocument.reviewedByUserId`,
  `Dispute.raisedByUserId`, `Dispute.resolvedByUserId`,
  `DisputeEvidence.submittedByUserId`. Postgres does not auto-index FK
  columns (unlike primary keys) — all 11 now have `@@index`.
- **5 of the 26 requested models were missing `updatedAt`**:
  `RequestPhoto`, `QuoteItem`, `MessageAttachment`, `DisputeEvidence`,
  `ConversationMember`. All fixed. `AuditLog` remains the one deliberate
  exception (see its section below).

Known limitation: the CHECK constraints (the "exactly one of
professionalProfileId/companyProfileId" rules) live in
`prisma/migrations/20260717000000_init_domain_model/migration.sql`,
hand-authored rather than engine-generated. They're standard, simple
Postgres SQL (`num_nonnulls(...) = 1`), but should be re-verified against
a real `prisma migrate dev` run before relying on them in production.

## Reference data (seeded, not core marketplace entities)

### Language
Spoken/interface languages. Seeded at deploy time; referenced by User
(preferred language) and ProfessionalProfile (languages spoken, for
customer-professional matching).

### Role
Platform roles for RBAC. Kept as seeded data (not a hardcoded enum) so
new roles (e.g. "SUPPORT") can be added without a schema migration. A
user can hold multiple roles at once — e.g. someone can be both a
CUSTOMER and a PROFESSIONAL on the same account.

### UserRole
Join table: which roles a user holds.

### Country / Province / City
Normalized geographic reference data, independent of `Address` (which
keeps storing city/province/country as free-text — see the header note
in schema.prisma for why these weren't merged). Seeded with exactly
Spain → Valencia → Gandia per this phase's request; designed to extend
to more locations without a schema change.

### PlatformSetting
Key/value platform configuration (commission rate, default currency,
support email, maintenance-mode flag) so ops can change these without a
deploy. `value` is `Json` so one table covers settings of any shape.

## Identity & Profiles

### User
The Auth.js-required identity table, extended with marketplace fields
(`phone`, `status`, `preferredLanguageId`, `deletedAt`, `lastLoginAt`).
Every other actor in the system (customer, professional, company
member, admin) is a User with an additional profile/membership attached
— there's no separate "Admin" table; admin-ness comes from a `Role` via
`UserRole`. Soft-deleted (`deletedAt`) rather than hard-deleted, because
so much of this schema (messages, reviews, payments, disputes) holds a
`Restrict`-protected FK back to a specific user for legal/audit reasons
— hard-deleting a user with any transaction history should fail loudly,
not cascade silently.

### Address
A saved address, owned by a user. Reused as billing addresses, service
locations, etc. Soft-deleted (not hard-deleted) because ServiceRequest
and Appointment keep a Restrict-protected FK to specific addresses for
historical accuracy — removing an address from an active address book
should not corrupt past job records.

### CustomerProfile
Customer-specific extension of User. Deliberately thin — most identity
data lives on User itself; this only holds fields meaningful to the
"requests services" side of the marketplace.

### ProfessionalProfile
An individual freelance professional (not affiliated with a company).
Holds everything specific to "offers services solo": rate, radius,
verification/trust signals, and the Stripe Connect account payouts go to.

### CompanyProfile
A company/business account. Companies act on requests through their
CompanyMember employees, but the business entity itself (legal name, tax
id, verification, Stripe Connect account) lives here.

### CompanyMember
Join table: which users work for which company, and in what capacity.
`removedAt` is a purpose-named soft-delete — it marks when someone's
membership ended without deleting the row, preserving "who worked here
and when" for dispute/audit purposes.

## Service Catalog

### ServiceCategory
Hierarchical service categories (e.g. "Fontanería" → "Reparación de
fugas"). Self-referencing for subcategories. Soft-deleted rather than
hard-deleted so historical ServiceRequests keep a valid category
reference even after a category is deprecated.

## Requests, Quotes & Scheduling

### ServiceRequest
A customer's request for a service — the core "job posting" of the
marketplace. FKs to CustomerProfile/ServiceCategory/Address are Restrict
(not Cascade): a request is a historical/financial record and must not
silently disappear if, say, an address is later removed from a user's
address book — removal there is itself soft-deleted for this reason.

### RequestPhoto
Photos the customer attaches to a request (e.g. a photo of the leak).
Cascades with its parent request — a photo has no meaning on its own.

### Quote
A professional's or company's bid on a ServiceRequest. Exactly one of
`professionalProfileId`/`companyProfileId` is set — enforced by a CHECK
constraint added in the migration (Prisma's schema language can't
express multi-column CHECK constraints natively). `submittedByUserId`
records which specific person submitted it (the solo pro themself, or a
specific CompanyMember acting on the company's behalf).

### QuoteItem
Line items making up a Quote's total (labor, materials, call-out fee,
etc.). `amount` is stored (not computed) so historical quotes remain
accurate even if pricing logic changes later.

### Appointment
A scheduled (or completed) visit stemming from an accepted Quote. One
Quote can produce multiple Appointments (e.g. a multi-day renovation
job), which is why this isn't just a field on Quote.

## Messaging

### Conversation
A chat thread. Usually tied to a ServiceRequest (customer ↔
professional/company discussing a job); `serviceRequestId` is nullable
to also allow platform/support conversations not tied to a request.

### ConversationMember
Join table: who's in a conversation. `leftAt` lets someone leave without
losing the historical fact they were part of it; `lastReadAt` backs
unread-message counts.

### Message
A single chat message. `senderId` is Restrict (not Cascade) so message
history survives even if the app is ever configured to hard-delete a
user — in practice, User uses soft delete for exactly this reason, so
this constraint should rarely if ever actually block anything.
`deletedAt` supports a user "unsending" their own message.

### MessageAttachment
Files attached to a message (photos, PDFs, etc.). Cascades with its
parent message.

## Reviews

### Review
A customer's review of a completed ServiceRequest. Exactly one of
`revieweeProfessionalProfileId`/`revieweeCompanyProfileId` is set (CHECK
constraint in migration), matching the same solo-pro-vs-company duality
used on Quote/Payout/etc. `response` lets the professional/company reply
publicly, a standard marketplace pattern.

## Payments & Finance

### Payment
A customer's payment for a ServiceRequest/Quote. All money fields use
`Decimal(10,2)` — never `Float` — to avoid floating-point rounding
errors in financial data.

### Commission
The platform's fee taken from a Payment. One-to-one with Payment. `rateBps`
(basis points, e.g. 1000 = 10.00%) avoids the float-precision issues a
percentage stored as a fraction would introduce. Unlike
Quote/Review/Payout/VerificationDocument/Dispute, its
professionalProfileId/companyProfileId pair is constrained to "at most
one" (not "exactly one") — a manual platform adjustment with neither set
is a legitimate edge case here.

### Payout
A payout of earnings to a professional or company via Stripe Connect.
Same solo-pro-vs-company duality pattern as Quote/Review.

### Refund
A refund against a Payment. `requestedByUserId` may be the customer or
an admin acting on a dispute resolution.

### Transaction
Append-only general ledger. Every money movement (charge, refund,
payout, commission, manual adjustment) gets one Transaction row, giving
a single queryable audit trail independent of which specific table
generated it. `amount` is signed (positive = inflow, negative = outflow)
— deliberately excluded from the "amount ≥ 0" CHECK constraints applied
to Payment/Refund/Payout/Commission.

## Notifications

### Notification
A single notification instance for a user across any channel. Unlike
most tables here, this Cascades with User — notifications are
disposable, not part of the financial/legal record.

## Trust & Safety

### VerificationDocument
A KYC/verification document uploaded by a professional or company. Same
solo-pro-vs-company duality pattern. `reviewedByUserId` uses SetNull
(not Restrict) — losing the "who reviewed this" pointer if that admin
account is later removed is an acceptable trade-off; the document and
its outcome remain intact.

### Dispute
A dispute raised over a ServiceRequest. Same duality pattern on the
respondent side. `resolvedByUserId` uses SetNull for the same reason as
`VerificationDocument.reviewedBy`.

### DisputeEvidence
Supporting evidence (photos, documents) submitted for a Dispute by
either party. Cascades with its parent dispute.

## Platform / Audit

### AuditLog
Append-only audit trail of significant actions across the platform.
Deliberately has **no** `updatedAt` and **no** soft delete — the one
intentional exception to the schema's general timestamp/soft-delete
conventions — because an audit log entry that could be edited or hidden
after the fact would defeat its entire purpose. `actorUserId` is
nullable + SetNull for system-initiated actions (e.g. an expired-request
cron job) with no human actor. `entityType`/`entityId` form a
lightweight polymorphic reference rather than one FK column per possible
entity, since virtually every table here could need to be audited.

## Known open design question (not fixed — flagged for Phase 2 discussion)

`Payment.quoteId` is nullable. When set, the paid professional/company is
derivable via `Payment → Quote → (professionalProfile | companyProfile)`.
When null (e.g. a deposit taken before a quote exists), there's no clear
recipient on the Payment record itself. Worth deciding deliberately in
Phase 2 rather than silently patched here, since it's a business-logic
question ("can a payment exist before a quote?") rather than a schema
defect.
