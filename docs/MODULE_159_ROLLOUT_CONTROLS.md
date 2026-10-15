# Module 159 — Rollout Controls (LEAD_V1)

Status: implemented on `feature/module-159/rollout-controls`. **Default behaviour: LEAD_V1 new activity is DISABLED.** This module provides the controls for a controlled rollout. It does **not** pass Gate B, does **not** enable LEAD_V1 anywhere, and does not by itself authorize a production rollout (see §10).

## 1. What this module is — and is not

M159 adds one operator switch that decides whether **new** LEAD_V1 activity may start. It is a rollout / kill switch and nothing else.

It is **not**: authorization (who may act), consent or privacy policy (M158), pricing or priceability (M132/M133), purchase eligibility (M147), fraud/abuse control (M156), a legal or refund policy, or an experiment platform. Opening an area never grants anything: every existing gate still runs after the switch. Closing an area never removes anything anyone already has.

It changes no pricing, no affiliate reward, no refund or legal policy, no database schema, and not the cutover strategy (M165).

## 2. Existing controls found (and why a new variable was still needed)

| Existing control | What it does | Why it is not the rollout switch |
|---|---|---|
| Module 52 feature flags (`FEATURE_FLAGS_ENABLED`, `FEATURE_FLAGS_CONFIG`, `customer-payment-capture`) | Boolean/percentage flags, process-cached service. | `FEATURE_FLAGS_ENABLED=false` switches off **every** flag including the legacy payment-capture kill switch; the flag service is built once per process from a JSON blob (a malformed blob is *ignored*, i.e. it degrades to code defaults); a boolean cannot express the four states needed (entry / purchase). Reusing it would couple LEAD_V1 to legacy payments and to an unrelated global switch. The M159 switch is therefore independent of it in both directions (pinned by tests). |
| `LEAD_PRICING_CONFIG_VERSION` (M132) | Selects the released pricing snapshot; fails closed. | Pricing, not rollout. Unchanged. The pilot category list is reused as the category allow-list (§8). |
| `LEAD_CONTACT_SHARING_BASIS` (M158) | Lawful basis for sharing contact; undecided = pre-M158 behaviour, invalid = `CONSENT`. | Privacy policy, not rollout. Unchanged. |
| `LEAD_ABUSE_CONTROL_MODE` (M156) | OFF/SHADOW/FLAG/ENFORCE risk layer. | Risk layer, not rollout. Unchanged; the rollout guard runs *outside* it so a refused call spends no abuse budget. |
| Legacy flow guard (M121/M131) | Rejects LEAD_V1 requests in 11 legacy money operations. | Independent of this switch and active in **every** mode (§7). |
| M142 "temporary config guard" | Referenced by the roadmap. | **Never existed in the repository**; there was nothing to replace. |

Before M159, no LEAD_V1 entry point had any rollout gate.

## 3. Configuration

One variable, read from the process environment **on every call** (the M156/M158 convention), so a cached use case or long-lived process can never act on a stale value:

```
LEAD_V1_ROLLOUT_MODE = DISABLED | ENTRY_ONLY | PURCHASE_ONLY | ENABLED
```

Exact and case-sensitive. No trimming, no aliases (`true`, `on`, `1`, `enabled`, ` ENABLED` are **not** `ENABLED`).

| Configuration | Effective mode | Status |
|---|---|---|
| unset or empty | `DISABLED` | `DEFAULT` |
| exact mode name | that mode | `CONFIGURED` |
| anything else (typo, wrong case, padding, non-string) | `DISABLED` | `MISCONFIGURED` (value-free warning logged; raw value never logged) |
| environment cannot be read | `DISABLED` | `MISCONFIGURED` |
| guard's reader throws / returns garbage | refused | fail closed |

Every failure mode moves towards DISABLED, never towards enabled.

Code: `domain/services/lead-rollout.ts` (pure), `infrastructure/config/lead-rollout-config.ts` (loader), `application/use-cases/lead-rollout/{lead-rollout-guard,compose}.ts` (guard + factories).

Does a change need a redeploy? **Yes, through the platform's normal mechanism for environment changes** (a new deployment or instance restart; there is no remote configuration service and no database-backed flag, deliberately). Within a running instance the value is never cached.

## 4. States

| Mode | ENTRY area (customers) | PURCHASE area (professionals) |
|---|---|---|
| `DISABLED` (default / misconfigured) | blocked | blocked |
| `ENTRY_ONLY` | allowed | blocked |
| `PURCHASE_ONLY` (drain) | blocked | allowed |
| `ENABLED` | allowed | allowed |

"Allowed" means *the switch does not stop it*; ownership, verification, eligibility (M147), priceability (M133), consent (M158), abuse (M156) and every other gate still decide.

## 5. Operation matrix

Blocked operations fail with one uniform `LeadV1RolloutDisabledError` (code `LEAD_V1_ROLLOUT_DISABLED`, message "This feature is not available right now.", localized in all 12 locales). It names neither the area nor the mode. The guard is **outermost**, so a refused call reads nothing, writes nothing, records no consent evidence and spends no M156 rate-limit budget.

| Operation | Area | When the area is closed |
|---|---|---|
| Submit a lead request (`SubmitLeadRequestUseCase`) | ENTRY | **Blocked** |
| Create LEAD_V1 service request (`CreateLeadV1ServiceRequestUseCase`) | ENTRY | **Blocked** |
| Create lead (`CreateLeadUseCase`) | ENTRY | **Blocked** |
| Publish lead (`PublishLeadUseCase`) | ENTRY | **Blocked** |
| Marketplace feed and published-lead list | PURCHASE | **Blocked** |
| Initiate purchase (`InitiateLeadPurchaseUseCase`) | PURCHASE | **Blocked** |
| Initiate lead-fee payment (`InitiateLeadFeePaymentUseCase`) | PURCHASE | **Blocked** |
| Lead-fee payment webhook (confirmation) | — | **Allowed, always** — a switch must never strand a paid purchase |
| Chargeback / dispute webhook, dispute evidence, revocation | — | **Allowed, always** |
| Contact access for a `CONFIRMED` buyer (M138) | — | **Allowed, always** (still subject to M139/M155/M158 rules) |
| Single-lead preview and own-purchase checkout state | — | **Read-only, allowed** (the checkout page of an existing purchase reads them) |
| Lead-fee refund execution, credit notes, invoices, reconciliation (M149–M153) | — | **Allowed, always** |
| Quality claims (submit / review / decide, M154) | — | **Allowed, always** |
| Admin console reads and mutations (M157) | — | **Allowed, always**; the console shows the effective mode, read-only |
| Consent withdrawal and the retention cron (M158) | — | **Allowed, always** |
| Cancelling / closing an existing request or lead (M130) | — | Not governed by the switch |
| Scheduled jobs | — | None of the existing cron routes creates leads or purchases; none is governed by the switch |

Existing purchases, financial records, invoices, claims, disputes and the audit trail are never touched. Nothing is revoked or deleted when the switch is turned off.

## 6. Why the switch cannot be bypassed

- All eight guarded use cases are constructed in exactly one file each (their composition root), and that factory returns the guarded object. Server Actions and routes reach use cases only through those factories. `lead-rollout-boundary-m159.test.ts` fails if any other production file constructs one, if a factory's returned value is not the guarded one, or if `src/app` builds one.
- The nested factories are guarded too (`CreateLead…` inside `CreateLeadV1…` inside `SubmitLeadRequest`), so reaching an inner factory directly is also refused.
- The environment is read per call; a factory built before the switch changed obeys the current value.
- Residual risk (documented, not hidden): new production code that constructs one of these use classes itself, bypassing its factory, would bypass the guard. The boundary test is the control against that.

## 7. Legacy isolation (unchanged, independent)

The M121/M131 legacy-flow guard and its isolation matrix do not depend on this switch and hold in every mode, including `ENABLED`. The rollout code imports nothing from legacy quote/payment/commission/payout/settlement/invoice/affiliate code and nothing from Module 52; the legacy `customer-payment-capture` kill switch and `FEATURE_FLAGS_*` are unaffected, and vice versa. LEAD_V1 traffic cannot be routed into a legacy flow by this module. Enabling LEAD_V1 does not alter the default cutover strategy.

## 8. Compatibility with pricing and GDPR configuration

- **Pricing (M132/M133).** `ENABLED` does not relax anything: with `LEAD_PRICING_CONFIG_VERSION` unset/invalid, publication still fails closed. The pilot category list (M132) is the category allow-list; M159 adds no second list.
- **Privacy (M158).** `DISABLED` blocks submission *before* any consent evidence is captured. With `ENABLED` and an undecided lawful basis the M158 behaviour is unchanged (D19 remains a Gate B blocker, not solved here).
- **Abuse (M156).** The rollout guard wraps outside it; the abuse mode is independent.

## 9. Known behaviour and limits

- **Unpaid purchases.** A purchase already `PENDING_PAYMENT` when PURCHASE closes cannot start a *new* payment attempt. No money has moved. A payment attempt created earlier can still complete and is confirmed by the webhook. No automatic expiry of unpaid purchases and no operator tool to cancel them was found in the repository, so they stay pending until the area reopens. Not changed here (new lifecycle behaviour is out of M159's scope); M160/M161 should decide whether a runbook step is needed.
- **In-flight requests.** A request that already passed the guard completes normally.
- **Not delivered (deferred, see §11):** per-region allow-lists, per-professional cohort, and the per-professional legacy/LEAD_V1 state that M148 anticipated.

## 10. Preconditions before enabling in production (none of these is verified by M159)

M159 is only the lever. Do **not** set anything other than `DISABLED` in production until all of the following are true:

1. M160 (Observability & Runbooks) and M161 (End-to-End, Concurrency & Load Verification) are complete and green.
2. Gate B is approved by its own checklist: M146–M161 complete; D1, D12, D14, D15, D16, D17, D19 closed with advisor confirmation; D21 pilot scope defined; real issuer legal name/CIF configured; ledger, invoices, credit notes and reconciliation clean over a rehearsed period; runbooks rehearsed; alerts firing in staging; **kill switch rehearsed in staging** (this module's exit criterion).
3. `LEAD_PRICING_CONFIG_VERSION` set to a released snapshot; `LEAD_CONTACT_SHARING_BASIS` decided; `LEAD_ABUSE_CONTROL_MODE` reviewed (SHADOW before ENFORCE, per M156).
4. The invoice and credit-note policy approval references (M150/M151) are set.

**This document does not claim that Gate B has been passed. It has not.**

## 11. Dependencies and follow-ups

- **M160:** will add structured events/metrics/alerts and the kill-switch runbook (turn-off, verify, turn-on). M159 emits only a value-free warning for a misconfigured value; no metric.
- **M161:** must exercise every mode and every row of §5 end to end (including the webhook staying live while PURCHASE is closed) and the concurrency behaviour under real PostgreSQL.
- **Deferred pending D21:** region allow-list, per-professional cohort, per-professional legacy/LEAD_V1 state (M148). The roadmap lists them under M159; they were not invented here because the cohort definition is an open business decision.
- **Gate B / M165:** the cutover default is untouched by M159. M165 later derives the new-request default from this module's ENTRY area (no second switch) — see `docs/MODULE_165_LEAD_V1_DEFAULT_CUTOVER.md`.

## 12. Deployment and rollback

Deployment of this module is inert: the default is `DISABLED`, which is also the effective state in every environment that sets nothing.

To open (staging first, never production before §10): set `LEAD_V1_ROLLOUT_MODE` in the environment, redeploy/restart, confirm the console banner shows the mode, then exercise the flows. A staged order is `ENTRY_ONLY` → `ENABLED`.

To stop new activity (kill switch): set `LEAD_V1_ROLLOUT_MODE=DISABLED` (or remove the variable) and redeploy/restart. Use `PURCHASE_ONLY` to let professionals finish buying already-published leads while customers stop creating new ones. Webhooks, refunds, contact access for confirmed buyers and admin operations continue in every mode.

Rollback of the code is a revert of this branch; there is no migration, no data change and no persistent state to undo.

## 13. Tests

`tests/unit/core/domain/services/lead-rollout-m159.test.ts` (parsing, matrix, hostile values, uniform error) · `tests/unit/core/infrastructure/config/lead-rollout-config-m159.test.ts` (loader: defaults, invalid, per-call read, unreadable env, independence from other switches) · `tests/unit/core/application/use-cases/lead-rollout/lead-rollout-guard-m159.test.ts` (every mode × area, fail-closed readers, pass-through fidelity, burst under a flipping switch) · `…/lead-rollout-wiring-m159.test.ts` (the real factories: all eight refused by default, mode matrix, stale-instance, unguarded paths) · `tests/unit/prisma/lead-rollout-boundary-m159.test.ts` (static contract) · `tests/unit/i18n/lead-rollout-i18n-m159.test.ts` (12 locales).

Real-PostgreSQL integration: **no new DB test was added** because M159 adds no database code, schema or state; the preserved paths (webhooks, contact access, refunds, claims) are not modified, and their existing tests (including `tests/integration-db`) are the regression evidence — they must be re-run against a disposable local PostgreSQL before merge (`npm run test:integration:db`).
