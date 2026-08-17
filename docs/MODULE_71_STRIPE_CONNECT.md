# Module 71 — Stripe Connect

## Scope

This module implements the Stripe Connect infrastructure that lets
MaestroYa associate a professional with a real Stripe Express connected
account, drive them through Stripe's hosted onboarding, synchronize the
account's capability/payout state, and open the Stripe Express Dashboard.
It does **not** implement payment execution (capturing a customer charge
or creating the professional's `Transfer`), webhook handling, or
VAT/invoicing — those are Module 72 (Webhooks) and Module 73
(VAT/Invoices).

This document is the architectural decision record (ADR) for the choices
this module locks in, so a future module (72/73) or maintainer does not
have to re-derive them from source comments alone. It reflects the
corrected state of the module after a post-implementation architecture
audit; see the "Post-audit corrections" section below for what changed
and why.

## Decision 1 — Connect charge type: Separate Charges and Transfers

**Decision:** customer charges are created on the *platform's* Stripe
account (unaffected by this module); a professional's payout is a
separate `Transfer` API call MaestroYa's own code initiates once it has
decided the professional should be paid.

**Primary reason — separating payment capture from payout release.**
MaestroYa already has a domain requirement, independent of Stripe, that a
professional's payout must not be released at the moment a customer pays:
`payment-release-decision.ts` (Module 66 — Job Completion & Payment
Release Protection) can return `RELEASE_APPROVED`, `HELD`, or `DENIED`
based on job-completion confirmation, dispute state, and trust/KYC
checks that are evaluated *after* the customer's payment has already been
captured. Destination charges collapse "charge the customer" and "credit
the connected account's balance" into a single Stripe API call — the
funds move into the connected account's balance (even if payout itself is
delayed) at charge time, which does not give MaestroYa a point to
withhold the transfer pending its own release decision. Separate Charges
and Transfers is the only one of Stripe's Connect charge-type patterns
that lets the `Transfer` itself happen as an independently-timed second
API call, so it is the only model compatible with Module 66's hold logic
existing at all. This is why the model was chosen — not a refund/dispute
liability difference between the two charge types, which the
implementation report originally (and incorrectly) cited as the primary
reason.

**Secondary property — refund/dispute posture.** Because the charge is on
the platform account, refunds and disputes are handled against the
platform's own charge and stay entirely within MaestroYa's existing
`Refund`/`FinancialAdjustment`/`DisputeResolutionDecision` domain models
(Modules 21/68), rather than Stripe's Connect-specific dispute-liability
rules for destination charges. This is a genuine, useful property of the
chosen model, but it is a secondary benefit of a decision already made
for the payment-capture/payout-release separation reason above — not
itself the deciding factor. (Per Stripe's own documentation, both charge
types can be configured with equivalent liability behavior via
`on_behalf_of`/liability settings; the two patterns are not different on
this dimension by default in the way the original report implied.)

**Alternatives considered and rejected:**
- **Destination charges** — rejected because of the release-timing
  problem above.
- **Direct charges** — rejected because MaestroYa needs to remain the
  merchant of record (Express accounts are not expected to run their own
  full checkout/compliance stack); direct charges make the connected
  account the merchant of record for that charge.

**When to revisit:** only if Module 66's hold/release model is itself
redesigned to no longer require a time gap between payment capture and
payout release. No such redesign is planned; this module does not
speculate about one.

## Decision 2 — Account type: Express (not Standard, Custom, or Accounts v2)

**Express**, not Standard/Custom: professionals need Stripe-hosted
onboarding and a Stripe-hosted dashboard MaestroYa does not want to build
or maintain itself, while MaestroYa still wants to remain the merchant of
record and keep charge/refund/dispute handling on the platform account
(see Decision 1). Express is Stripe's account type built for exactly this
"platform manages the relationship, Stripe hosts the onboarding UI" shape.

**Accounts v2 (Stripe's newer unified account API, in preview as of this
module's implementation):** deliberately **not** adopted. Stripe has been
previewing a v2 Accounts API intended to eventually unify Standard/
Express/Custom under one configuration-based model. As of this module's
implementation it remains a preview API, not the generally-available
default Connect surface, and migrating to it is a non-trivial API-shape
change (different account-creation/configuration semantics) with no
functional requirement driving it today. **Decision: stay on the classic
Express account type (`type: "express"`), monitor Stripe's v2 rollout
announcements, and revisit only once v2 reaches general availability and
Stripe publishes a migration path for existing Express accounts.** This
module does not migrate anything now.

## Decision 3 — Capabilities requested: `transfers` only

**Post-audit correction.** The first implementation requested both
`card_payments` and `transfers` on account creation. This was incorrect
for this Connect model and has been corrected to request `transfers`
only.

Per Stripe's account-capabilities documentation
(https://docs.stripe.com/connect/account-capabilities), `card_payments`
is the capability that lets a connected account itself "directly process
card and ACH payments" — i.e. be the account a charge is created *on* or
*on behalf of*. Under Separate Charges and Transfers (Decision 1), every
customer charge is created on the platform's own Stripe account; a
professional's connected account is never itself the account processing
a charge. The same documentation describes `transfers` as the capability
required to "transfer funds to connected accounts," explicitly covering
both destination charges and separate charges and transfers as the
patterns that depend on it. `card_payments` therefore has no function in
this model: requesting it would only add unnecessary Stripe-side
verification requirements (business/charge-processing details) for a
capability the professional's account will never use.

## Decision 4 — Payout-readiness formula (post-audit correction)

**The problem.** The first implementation's `isStripePayoutEligible`
gated readiness on `chargesEnabled && payoutsEnabled`, reading Stripe's
`account.charges_enabled` field. Stripe defines `charges_enabled` as
"whether the account can process charges"
(https://docs.stripe.com/api/accounts/object), and ties that specifically
to the `card_payments` capability. Because this integration (Decision 3,
both before and after the correction) never had a functioning reason to
make `charges_enabled` true — and after the Decision 3 correction,
never requests `card_payments` at all — `charges_enabled` reads `false`
permanently for every account this module creates. A permanently-false
term in an AND-gate makes the whole gate permanently false: no
professional could ever have reached payout-eligible or `READY` status
under the original formula. This was the most serious defect surfaced by
the architecture audit.

**The fix — a two-signal model**, both read from the same
`accounts.retrieve` call (no additional Stripe API call):

- **Transfer readiness** (`transfersActive`) — `account.capabilities.
  transfers === "active"`. Whether Stripe will currently accept a
  `Transfer` created *to* this account. This is the capability this
  Connect model actually depends on (Decision 3).
- **Payout readiness** (`payoutsEnabled`) — Stripe's own `account.
  payouts_enabled` ("whether the funds in this account can be paid out"
  — same Stripe API reference above). Whether funds already sitting in
  the connected account's Stripe balance can be paid out to its external
  bank account.

`isStripePayoutEligible = transfersActive && payoutsEnabled`.
`deriveStripeExpressReadiness` additionally requires `detailsSubmitted`
before returning `READY` (an account can have both flags true while
Stripe is still collecting non-blocking "eventually due" requirements —
that alone does not block money movement and is intentionally not part
of this gate; see `stripe-connect-account-rules.ts`'s own doc comment).

Both signals are kept distinct rather than collapsed into one boolean:
transfer readiness governs whether money can arrive at the account,
payout readiness governs whether money already there can leave to a bank
account, and nothing in this Connect model guarantees one implies the
other.

**Why not just switch to `payoutsEnabled` alone.** `payoutsEnabled` on
its own does not confirm the platform can actually create a `Transfer`
into the account in the first place — it only reflects whether existing
balance funds can be paid out. Relying on it alone would silently pass
readiness for an account Stripe would still reject a `Transfer` against,
which is a worse failure mode (a transfer attempt fails downstream in
Module 72/73, rather than the account correctly staying `PENDING` here).
The two-signal model was chosen specifically to keep both capability
boundaries — Stripe's and MaestroYa's — checked explicitly rather than
assuming either one alone is sufficient.

**Database note.** No schema migration was required. The existing
`ProfessionalPayoutAccount.stripeChargesEnabled` boolean column (added by
this module's original migration,
`20260902000000_add_stripe_connect_account_state`) is reused to store
`transfersActive` rather than the literal Stripe `charges_enabled` value
— its shape (`Boolean NOT NULL DEFAULT false`) already fits the new
meaning exactly, and the default (`false` = "not yet transfer-ready") is
still correct for every existing row. The column is deliberately not
renamed or migrated; every place its meaning is repurposed carries an
explicit "POST-AUDIT CORRECTION" comment (`prisma/schema.prisma`, the
`ProfessionalOnboardingRepository` interface, and the Prisma repository
implementation) so a future reader is never misled by the column name
alone.

## Decision 5 — Commission representation: not `application_fee_amount`

MaestroYa's commission (10% of the full presupuesto — labor + materials,
computed by `CommissionCalculationService`, Module 64) is **never**
represented as Stripe's `application_fee_amount` parameter. Instead:

```
Transfer.amount = professionalPayout   (= presupuestoTotal - commission,
                                          e.g. €1,200 - €120 = €1,080)
```

MaestroYa creates a `Transfer` for exactly the professional's computed
share; the commission itself is simply the difference between the
platform charge amount and the transfer amount, and is never sent to
Stripe as a labeled fee field. This keeps 100% of the commission
arithmetic inside MaestroYa's own domain layer
(`CommissionCalculationService`), with Stripe never performing or
verifying any part of that calculation — consistent with this module's
non-negotiable business rule that commission is computed only by
MaestroYa's domain layer. `application_fee_amount` is Stripe's mechanism
for platforms that want Stripe itself to compute and enforce the
platform's cut as part of the charge/transfer object; MaestroYa's
existing dispute-resolution and financial-adjustment models (Module 68)
already assume full control over how much of a given payment reaches a
professional, which an `application_fee_amount`-based split does not
straightforwardly accommodate when an adjustment changes the amount after
the fact. This module adds no payment-execution code — Transfer creation
itself is Module 72/73's responsibility — this section exists purely to
record the decision before that code is written.

## Module 72/73 compatibility (verification only — not implemented here)

- **Module 72 (Webhooks):** `retrieveAccountStatus`/
  `GetStripeAccountStatusUseCase` already return exactly the shape an
  `account.updated` webhook handler needs (`transfersActive`,
  `payoutsEnabled`, `detailsSubmitted`, `requirementsCurrentlyDue`,
  `disabledReason`), and `findPayoutAccountByStripeAccountId` (added by
  this module) lets that handler look up a professional by Stripe account
  id without any further repository-interface change. The corrected
  two-signal readiness model requires no different data from Stripe than
  the original formula did — both `capabilities.transfers` and
  `payouts_enabled` are already present on every `Account` object Stripe
  sends in an `account.updated` webhook payload, so Module 72 needs no
  additional Stripe API call or webhook-payload change to reuse
  `deriveStripeExpressReadiness`/`isStripePayoutEligible` exactly as
  `GetStripeAccountStatusUseCase` does today.
- **Module 73 (VAT/Invoices):** unaffected by any of this module's
  post-audit corrections. `CommissionCalculationService`'s `adjustments`
  extension point remains the intended integration surface; nothing here
  computes VAT or issues invoices.

## Post-audit corrections summary

| Area | Before | After |
|---|---|---|
| Capabilities requested | `card_payments` + `transfers` | `transfers` only |
| Readiness signal | `charges_enabled` (permanently `false` under this model) | `capabilities.transfers === "active"` (`transfersActive`) |
| Payout eligibility formula | `chargesEnabled && payoutsEnabled` (always `false`) | `transfersActive && payoutsEnabled` |
| Stated rationale for Separate Charges and Transfers | Refund/dispute control (primary) | Payment-capture/payout-release separation (primary); refund/dispute control (secondary property) |
| Commission representation | Not previously documented | Documented here: `Transfer.amount`, never `application_fee_amount` |
| Express vs Accounts v2 | Not previously documented | Documented here: stay on Express, monitor v2, revisit at GA |
| Database schema | 5-column migration | Unchanged — no new migration; `stripeChargesEnabled` column's meaning repurposed with explicit doc comments |
