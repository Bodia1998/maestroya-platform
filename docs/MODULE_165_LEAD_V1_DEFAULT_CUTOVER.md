# Module 165 — LEAD_V1 Default Cutover

Status: implemented on `feature/module-165/lead-v1-default-cutover` (base: M164 merge `b0f1073`). **Default behaviour: unchanged.** With `LEAD_V1_ROLLOUT_MODE` unset (`DISABLED`) every request-creation path behaves exactly as before M165 and nothing new is read. This module does **not** pass Gate B, does not authorise a production rollout (§9), and is **not** legacy wind-down (M166) or removal (M167–M169).

## 1. What changed

Before M165 the flow of a new request was decided by *which entry point the customer used*: `/requests/new` → legacy action → `LEGACY_QUOTE_PAYMENT`; `/requests/new/lead` (M142) and the M125 action → `LEAD_V1`. Nothing made LEAD_V1 the default.

After M165, when LEAD_V1 is the **default for a category**, the application routes new requests to the LEAD_V1 entry and the legacy creation path refuses that category. "Default for a category" = **M159 ENTRY area open** (`ENTRY_ONLY` or `ENABLED`) **and** the category is supported by the **M132 pilot configuration**. Nothing else is configured: there is no new environment variable, no new flag, no schema change and no migration.

| Rollout mode | Pilot category | Other category |
|---|---|---|
| `DISABLED` (unset / invalid / unreadable) | legacy (as before) | legacy (as before) |
| `PURCHASE_ONLY` | legacy (ENTRY closed) | legacy |
| `ENTRY_ONLY` / `ENABLED` | **LEAD_V1** (legacy path refuses) | legacy (as before) |

## 2. Flow-selection paths (all discovered)

| Path | Before | After |
|---|---|---|
| `CreateServiceRequestUseCase` (via `createServiceRequestAction`, `/requests/new`) | always legacy | legacy, **except** it is refused (`LEGACY_REQUEST_CREATION_REDIRECTED`) for a category whose default is LEAD_V1. Wrapped by `LegacyRequestCreationGuarded` in `service-request/compose.ts` (the only place it is built). |
| `CreateLeadV1ServiceRequestUseCase` (`createLeadServiceRequestAction`) | always `LEAD_V1`, M159 ENTRY guard | unchanged |
| `SubmitLeadRequestUseCase` (`submitLeadRequestAction`, `/requests/new/lead`) | always `LEAD_V1`, M159 ENTRY guard, M132 category check, M158 consent, M163 scope | unchanged |
| `PrismaServiceRequestRepository.create` fallback `data.flowVersion ?? DEFAULT_TRANSACTION_FLOW_VERSION` and the DB column default | legacy | **unchanged** (no production caller relies on it; history is never reclassified) |
| `/requests/new` page | legacy form | asks `NewRequestFlowSelector`; redirects to `/requests/new/lead` when LEAD_V1 is the default; the legacy form lists only categories that stay legacy |

`tests/unit/prisma/new-request-flow-boundary-m165.test.ts` pins this inventory: it fails if another file writes a `service_requests` row, calls `ServiceRequestRepository.create`, constructs the legacy use case, or consumes the selector.

## 3. Selection logic and fail-safe semantics

Code: `domain/services/new-request-flow.ts` (pure rule + `LegacyRequestCreationRedirectedError`), `application/use-cases/new-request-flow/{new-request-flow-selector,legacy-request-creation-guard,compose}.ts`.

- `selectNewRequestFlow` returns `LEAD_V1` only when both facts are strictly `true`. Anything else is the pre-M165 default.
- The ENTRY fact comes from `getLeadRolloutStatus().entryOpen` (M159: read per call, never throws, any invalid/unreadable value = `DISABLED`). M165 reads no environment variable itself.
- The category fact is the M132 policy (`leadRequestCategoryPolicyFrom(resolveLeadPublicationConfiguration())`, the same source as the M142 picker and M133 publication). Invalid / missing pilot configuration or a throwing resolver ⇒ nothing is eligible ⇒ legacy continues.
- ENTRY closed ⇒ the category tables are **not read at all** (inert at the default).
- Unknown/inactive category ⇒ legacy decision (the legacy use case then reports its own validation error).
- An **infrastructure failure** while reading categories is not swallowed: the creation fails ("creation failed") rather than guessing a flow.
- The LEAD_V1 entry keeps *all* its own gates (M159 guard, M132 category check, M158 consent, M163 scope, M133 publication, M164 pricing). M165 only decides where a customer is sent; it never creates LEAD_V1 requests itself, so the legacy form (which has no consent/scope capture) is never used to create a LEAD_V1 request.

## 4. Compatibility guarantees

- Existing rows are never read or written by M165. `ServiceRequest.flowVersion` remains the single source of truth for publication, pricing, purchasing, contact protection and payment; no code consumes the default after creation (pinned by test: only the repository, `transaction-flow.ts` and `new-request-flow.ts` mention `DEFAULT_TRANSACTION_FLOW_VERSION`).
- `LEGACY_QUOTE_PAYMENT` requests keep their quote/payment/commission/payout paths; `LEAD_V1` requests keep the lead lifecycle. The M121/M131 legacy guard and the flow reader do not import the cutover and hold in every configuration.
- Idempotency/concurrency: the selector is stateless and read-only; the flow is written once, at insert, by the creating use case, from the same literal as before. Retries and duplicate submissions are exactly as idempotent as before M165 (neither creation path has an idempotency key; M165 adds none). A configuration change between the selector check and the insert can let one in-flight legacy request through; it stays a valid legacy request.
- Messages: one new localized sentence (`errors.byCode.LEGACY_REQUEST_CREATION_REDIRECTED`) in all 12 locales; it names neither the mode nor the pilot configuration.

## 5. M164 pricing separation

M165 reads and sets nothing in M164 (`LEAD_REGIONAL_PRICING_MODE`, calibration release, review path). Turning the cutover on does not enable regional pricing: the mode still defaults to `OFF` and the shipped calibration release still has **no** entries and a disabled supply multiplier (asserted by test). A request created through the cutover is priced by the existing M132/M163 path, or goes to review/UNPRICED, exactly as an M142 request does today.

## 6. Rollback

Set `LEAD_V1_ROLLOUT_MODE=DISABLED` (or remove it) and redeploy/restart: `/requests/new` shows the legacy form again and the legacy action accepts every category. No data change is needed; already-created LEAD_V1 requests continue through the lead lifecycle (M159 §5). Code rollback is a revert of this branch (no migration).

## 7. Tests

`tests/unit/core/domain/services/new-request-flow-m165.test.ts` (rule, hostile values) · `tests/unit/core/application/use-cases/new-request-flow/new-request-flow-selector-m165.test.ts` (all four M159 modes, malformed values, per-call read, pilot policy, fail-safe/failure propagation, concurrency, guard) · `…/new-request-flow-wiring-m165.test.ts` (the real factories under each mode, stale-instance) · `tests/unit/prisma/new-request-flow-boundary-m165.test.ts` (creation-path inventory, no schema/env/second switch, M164 untouched) · `tests/unit/i18n/legacy-request-creation-redirected-i18n-m165.test.ts` (12 locales). `lead-rollout-boundary-m159.test.ts` gained one allow-list entry for the new composition root.

Real-PostgreSQL integration: **no new DB test** — M165 adds no database code, schema or state; the unchanged repository tests and `tests/integration-db` are the regression evidence.

## 8. Operational limitations (deliberate)

- **No cutover of quotes.** The roadmap text for M165 also lists "disable `CreateQuote` for new requests", copy/SEO updates and customer/professional notices. Not done here: the task was the controlled default only, and those depend on D20 and the notice-period decision. Legacy requests that already exist can still be quoted and paid.
- **Non-pilot categories stay legacy.** Only M132 pilot categories can be LEAD_V1 (they are the only priceable ones). With the cutover open, `/requests/new` with no category redirects to the lead form; a non-pilot category is reachable through `/requests/new?categoryId=<id>` deep links (marketing pages) and the legacy action. A customer with no deep link cannot pick a non-pilot category until the pilot list grows or M166 decides their fate.
- The category hint on a redirect (`?categoryId`, `?city`) is not carried to the lead form (it has no prefill).
- The legacy action's category check and the insert are separate steps (see §4).

## 9. Preconditions before enabling in production (not verified by M165)

Everything in M159 §10 (Gate B, D1/D12/D14–D17/D19/D21, pricing version, privacy basis, kill switch rehearsed), plus D20 (open legacy requests/jobs) and the customer/professional notice period (**legal/business decision required**). Do not set `ENTRY_ONLY`/`ENABLED` in production before they are closed. **Environments that already use `ENTRY_ONLY`/`ENABLED` (e.g. staging) change behaviour as soon as this ships**: pilot categories stop being creatable through the legacy form.
