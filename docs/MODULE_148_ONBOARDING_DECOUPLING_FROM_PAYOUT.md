# Module 148 — Onboarding Decoupling from Payout

M148 removes the payout destination from the set of steps required to activate a professional
(`ProfessionalOnboarding.status = ACTIVATED`). It adds no table, no migration and no schema change, adds
no Stripe/transfer/payout behaviour, and changes no pricing, IVA, invoice or lead-fee payment behaviour.

## The original coupling and its verified runtime path

* `ONBOARDING_STEP_VALUES` (`domain/services/professional-onboarding-rules.ts`) hard-coded six steps,
  including `PAYOUT_CONNECTED`.
* `computeOnboardingProgress` required all six: `isEligibleForActivation = steps.every(complete)`, and
  `PAYOUT_CONNECTED` was complete only if a `ProfessionalPayoutAccount` existed with status `PENDING` or
  `VERIFIED` (`isPayoutAccountConnected`).
* Both `ValidateProfessionalActivationUseCase` and `ActivateProfessionalUseCase` derive their answer from
  `GetOnboardingStatusUseCase` → `computeOnboardingProgress`. `ActivateProfessionalUseCase` is the only
  writer of `ACTIVATED`. So, in code, a professional with no payout destination could never be activated.

### Reachability (what was actually verified)

* The M62 onboarding use cases (`Start…`, `AcceptOnboardingTerms/PrivacyPolicy`, `SetPayoutDestination`,
  `GetOnboardingStatus`, `ValidateProfessionalActivation`, `ActivateProfessional`) are wired only in
  `use-cases/onboarding/compose.ts`. A search of `src`, `scripts`, `middleware.ts`, `auth.ts` and
  `instrumentation.ts` found **no page, Server Action, route or job that imports that composition root**.
  The professional onboarding screen in the app uses a different use case,
  `CompleteProfessionalOnboardingUseCase` (profile + base address + `signupIntent`), which never touched
  payout.
* **Nothing reads `ProfessionalOnboarding.status`.** The only other reference is `countByStatus`, used by
  the onboarding report.
* Consequently the coupling was real in the domain rule, its tests and the report script, but was **not
  reachable from production request paths** at the time of this module.

## What was decoupled

`professional-onboarding-rules.ts`:

| Export | Content |
|---|---|
| `ONBOARDING_REQUIRED_STEP_VALUES` (new) | `TERMS_ACCEPTED`, `PRIVACY_POLICY_ACCEPTED`, `IDENTITY_VERIFIED`, `BUSINESS_REGISTRATION_VERIFIED`, `PROFILE_COMPLETE` |
| `ONBOARDING_OPTIONAL_STEP_VALUES` (new) | `PAYOUT_CONNECTED` |
| `ONBOARDING_STEP_VALUES` (kept) | required + optional, so the `OnboardingStepValue` type and its consumers are unchanged |

`computeOnboardingProgress` now:

* builds `steps`, `completedStepCount`, `totalStepCount` and `isEligibleForActivation` from the **required**
  steps only (`totalStepCount` is now 5);
* returns the payout step in a new `optionalSteps` array with its real completion state, for display. It
  never blocks and is never counted.

The label for the optional step is now "Add a payout destination (optional)". The onboarding report
generator and `scripts/run-onboarding-report.ts` describe the required/optional split.

`GetOnboardingStatusUseCase`, `ValidateProfessionalActivationUseCase` and `ActivateProfessionalUseCase`
needed no code change: they were already driven by `computeOnboardingProgress`. `GetOnboardingStatusUseCase`
still returns `payoutAccount`, so any future UI can show the optional step.

## Onboarding lifecycle

Before: `IN_PROGRESS → ACTIVATED` required terms, privacy, identity, business registration, profile **and** a
non-rejected payout destination.

After: `IN_PROGRESS → ACTIVATED` requires terms, privacy, identity, business registration and profile. A
payout destination may be absent, `PENDING`, `VERIFIED` or `REJECTED` without affecting activation. The
state machine, the idempotent activation, the `ProfessionalOnboardingActivated` event and the audit-log
subscriber are unchanged.

## Controls that remain mandatory and separate

| Concern | Authority | Effect of M148 |
|---|---|---|
| Identity verification | `IDENTITY_VERIFIED` required step (Persona/manual case `APPROVED`) | unchanged, still required |
| Business registration | `BUSINESS_REGISTRATION_VERIFIED` required step (M74) | unchanged, still required |
| Lead-purchase identity/business gate | M98 `isProfessionalEligibleToPurchaseLeads` (`status ACTIVE` + `verificationStatus VERIFIED`) inside the M147 policy | untouched; does not read onboarding |
| Billing readiness | M146 `GetProfessionalBillingReadinessUseCase` (`billingReady`) | untouched; onboarding completion is **not** billing readiness |
| Lead-purchase eligibility | M147 `LeadPurchaseEligibilityPolicy` in purchase initiation and (new provider payment) fee-payment initiation | untouched; remains the only authority |

Removing the payout step cannot let an unverified professional buy leads: the purchase path never consulted
the onboarding aggregate, and M147 still requires `ACTIVE` + `VERIFIED` + verified billing. M148 does not
mark billing identity verified and adds no billing step to onboarding (the roadmap's "billing identity
complete" onboarding step was deliberately not added; see open decisions).

No code path was added that collects, holds, transfers or pays out a professional's service revenue.

## Legacy-flow considerations

Left untouched (frozen, not redesigned): `SetPayoutDestinationUseCase`, `PayoutProvider`
implementations, `ProfessionalPayoutAccount`, the Stripe Connect use cases and webhook, `CheckPayoutEligibilityUseCase`,
`ResolvePayoutDestinationUseCase` and `ExecuteProfessionalPayoutUseCase`.

The legacy payout path checks the payout account itself (`isPayoutAccountConnected` on the account status in
`ResolvePayoutDestinationUseCase`/`CheckPayoutEligibilityUseCase`) and does not consult
`ProfessionalOnboarding.status`. So making payout optional for activation does not let a legacy payout go to
a missing or rejected destination. `isPayoutAccountConnected` itself is unchanged.

## Tests

Added or changed (all under `tests/`):

* `unit/core/domain/professional-onboarding-rules.test.ts` — five required steps; payout absent / `PENDING` /
  `VERIFIED` / `REJECTED` all eligible; optional step reported with true state; a connected payout never
  compensates for any missing required step; `isPayoutAccountConnected` unchanged.
* `unit/core/application/use-cases/onboarding/activate-professional.use-case.test.ts` — activation without a
  payout account and with a `REJECTED` one; remaining-steps message never mentions payout; verified payout
  does not substitute for identity; approved identity without a business-registration document still refused
  with and without payout.
* `unit/core/application/use-cases/onboarding/get-onboarding-status.use-case.test.ts` — eligible with no payout
  account, payout reported as optional/incomplete.
* `integration/onboarding/onboarding-flow.test.ts` (in-memory fakes) — end-to-end flow is eligible before the
  payout step and unchanged after it; payout no longer listed as missing.
* `unit/prisma/onboarding-payout-decoupling-boundary-m148.test.ts` (new, static + behavioural) — payout not in
  the required set; activation/validation never reference payout; identity and business steps still
  required; no billing/lead-purchase/lead-fee/lead-contact source reads the onboarding aggregate; onboarding
  code does not reference billing or lead purchase; nothing outside the onboarding module composes the M62
  activation use cases; an onboarding-complete professional is still ineligible under the real M147 decision
  function when billing is missing or the profile is not `VERIFIED`; legacy payout resolution/eligibility
  still require a connected payout account and do not read onboarding status; LEAD_V1 purchase/fee/contact
  sources do not reference payout/Stripe Connect.

No existing test was weakened. Assertions that encoded the old rule were updated to the new rule (six → five
required steps; payout no longer a missing step). A mutation check (temporarily putting `PAYOUT_CONNECTED`
back into the required list) made 14 of the new/updated tests fail.

### Execution and limitations

The project's `node_modules` was installed on macOS and cannot run in the Linux environment this session
used, so checks were run from a scratch copy outside the project (fresh `npm ci`, Prisma types copied from
the project's existing generated client; no schema change). Results:

* Targeted onboarding/rules/boundary/integration files: 11 files, 83 tests passed.
* Full `tests/unit`: 660 files, 6229 tests passed. The run also reported 13 unhandled errors from the Prisma
  native query engine (the macOS engine library cannot load on Linux, e.g. `tests/unit/prisma_probe.test.ts`);
  they are environmental and unrelated to this change.
* `tsc --noEmit`: exit 0. ESLint on all changed files: exit 0. `git diff --check`: clean.
* **Not run:** database integration tests (`test:integration:db`) — no PostgreSQL available in this session
  and no schema/repository code changed. The existing real-DB suites were not exercised. Full-repo `eslint .`
  and the e2e (Playwright) suite were not run.

## Open decisions / unresolved

1. **Per-professional legacy flag (roadmap M148/M159).** The roadmap proposes requiring payout only for
   professionals still on the legacy flow, driven by a rollout flag. No such flag or per-professional state
   exists yet (M159 is not implemented), so none was invented. Payout is optional for everyone. If legacy
   professionals must keep a required payout step for activation during coexistence, that needs the M159
   flag, and since nothing reads `ACTIVATED` today the product impact of that choice is currently nil.
2. **D15 onboarding steps/terms** (lead-marketplace terms, billing step) remain a legal/business decision; no
   new step was added. Billing readiness is deliberately not an onboarding step.
3. **The M62 onboarding flow is not wired to any UI or gate.** `ACTIVATED` currently gates nothing, and
   `docs/MODULE_62_PROFESSIONAL_ONBOARDING.md` still describes the old six-step rule (superseded here).
4. `SetPayoutDestinationUseCase` has no legacy-flow guard of its own and no production caller; wiring or
   removing it is left to the later legacy-removal modules.
