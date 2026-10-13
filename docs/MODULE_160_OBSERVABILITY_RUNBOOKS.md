# Module 160 — Observability & Runbooks (LEAD_V1)

Status: implemented on `feature/module-160/observability-runbooks`, after M159 (Rollout Controls) and before M161 (End-to-End, Concurrency & Load Verification). **This module does not enable LEAD_V1, does not pass Gate B and does not claim that production monitoring or alerting is active.** The default of `LEAD_V1_ROLLOUT_MODE` remains `DISABLED`.

Everything in this document is either (a) **Implemented** — verified in the repository and covered by tests — or (b) explicitly marked **Recommendation / missing infrastructure**. Where the two differ, section 14 says so.

## 1. Purpose and scope

M160 makes the M159 rollout switch operationally visible and gives operators safe procedures for the LEAD_V1 incidents that can be investigated with the tools the repository really has.

What M160 **implements** (code):

| Signal | Event name | Where | Level |
|---|---|---|---|
| Effective rollout state at process start | `lead_rollout.effective_mode` | `instrumentation.ts` (reuses the M159 loader) | info |
| A rollout guard refused a new operation | `lead_rollout.guard_blocked` | `lead-rollout-guard.ts` | info (`AREA_CLOSED`), error (`CONFIG_READER_FAILED`, `CONFIG_MALFORMED`) |
| Rollout variable invalid, fell back to `DISABLED` | `lead_rollout.config_invalid` | `lead-rollout-config.ts` (M159, unchanged) | warn |
| Rollout variable unreadable | `lead_rollout.config_unreadable` | `lead-rollout-config.ts` (M159, unchanged) | error |

What M160 **reuses without change** (already instrumented — no duplicate events were added): lead-fee payment initiation (`lead_fee_payment.denied`, `lead_fee_payment.provider_failed`, `lead_fee_payment.discard_failed`), webhook confirmation (`lead_fee_payment_webhook.*`, route events `stripe_payments_webhook_*`), duplicate deliveries (webhook outcome `duplicate`), dispute webhooks (`lead_fee_dispute_webhook.*`), refund anomalies (`Lead-fee refund …` error lines in `execute-lead-fee-refund.use-case.ts`), contact-access denials (`lead_contact_access.denied`), retention (`lead_privacy_retention.*`, `lead_privacy_retention_cron_*`), abuse-layer failures (`lead_abuse.*`), reconciliation (`reconciliation.*`, plus the CRITICAL-discrepancy alert path of M90).

What M160 **does not** do: no metrics, no new tracing, no new alert provider, no dashboard, no new logging framework, no database change, no scheduled job, no behavior change of any business flow, no M161 verification, no rollout enablement.

## 2. Rollout mode reference (as implemented by M159)

`LEAD_V1_ROLLOUT_MODE` — exact, case-sensitive, no trimming, no aliases (`true`, `on`, `1`, `enabled`, ` ENABLED` are **not** `ENABLED`).

| Mode | ENTRY area (customers: submit request, create/publish lead) | PURCHASE area (professionals: feed/list, initiate purchase, initiate lead-fee payment) |
|---|---|---|
| `DISABLED` (default; also the fallback) | blocked | blocked |
| `ENTRY_ONLY` | allowed | blocked |
| `PURCHASE_ONLY` (drain) | blocked | allowed |
| `ENABLED` | allowed | allowed |

"Allowed" only means the switch does not stop the call; ownership, eligibility (M147), pricing (M133), consent (M158) and abuse (M156) gates still run. A blocked call raises one uniform `LEAD_V1_ROLLOUT_DISABLED` error ("This feature is not available right now.") that names neither the area nor the mode.

## 3. Safe rollout verification (no secrets exposed)

Never print the environment or the `.env*` files to verify the mode. Use, in this order:

1. **Boot log line.** After every deploy/restart, search the application logs for the event `lead_rollout.effective_mode`. Its fields are exactly `mode`, `configStatus` (`DEFAULT` | `CONFIGURED` | `MISCONFIGURED`), `entryOpen`, `purchaseOpen`. It never contains the raw variable. `configStatus=MISCONFIGURED` means the value was not understood and the effective mode is `DISABLED` (the loader additionally logs `lead_rollout.config_invalid`, also without the value).
2. **Admin console banner.** An ADMIN/SUPER_ADMIN sees the effective mode, read-only, on the lead console (`/admin/leads`, M157/M159). It cannot be changed from there.
3. **Behavioral check (staging only).** A refused call writes `lead_rollout.guard_blocked` with the `area` that was refused. Seeing it for the area you expect closed confirms enforcement end to end.

Limits: the boot line is emitted by the process that started; each instance logs its own. A rolling deployment can briefly run instances with different values — verify every instance has restarted (the per-call read means an instance never uses a *stale* value, but an old instance still has the *old environment*). If `LOG_LEVEL` is `warn` or `error`, the info-level lines above are suppressed; use the admin banner instead.

## 4. Emergency disable procedure

Authorized operator only (whoever may change production environment variables; this repository does not define that role — record the approver in the incident record).

1. Decide the target: `DISABLED` stops customers and professionals; `PURCHASE_ONLY` lets professionals finish buying already-published leads while customers stop creating new ones. Neither touches existing purchases, webhooks, refunds, disputes, contact access of confirmed buyers or admin operations (section 8).
2. Set `LEAD_V1_ROLLOUT_MODE=DISABLED` (or remove the variable — the default is `DISABLED`) through the **platform's normal mechanism for environment changes**. The repository ships both a `vercel.json` (crons) and a Docker path (`docker-compose.prod.yml` with `env_file: .env.production`); it does not state which one production uses, and **there is no remote-config service or database flag**. On the compose path the variable must be present in the file that `env_file` points to (it is not listed in the compose file itself).
3. Redeploy / restart so every instance picks up the environment. The value is read on every call, but the *environment of a running process* only changes by restart.
4. Verify: `lead_rollout.effective_mode` on each new instance shows `mode=DISABLED`, `entryOpen=false`, `purchaseOpen=false`; the admin banner agrees.
5. Confirm the blast radius is limited: `lead_rollout.guard_blocked` appears for new activity; webhook events (`stripe_payments_webhook_lead_fee_processed`) keep processing.
6. Record: time, approver, previous mode, new mode, evidence (log lines — never the environment dump).

Do **not** edit database rows, delete purchases or disable the Stripe webhook endpoint as part of an emergency disable.

## 5. Fail-closed configuration

| Situation | Effective mode | Status | Signal |
|---|---|---|---|
| variable unset or empty | `DISABLED` | `DEFAULT` | `lead_rollout.effective_mode` at boot; `guard_blocked` per refusal |
| exact valid mode | that mode | `CONFIGURED` | `lead_rollout.effective_mode` at boot |
| typo, wrong case, padding, non-string | `DISABLED` | `MISCONFIGURED` | `lead_rollout.config_invalid` (warn, no value) |
| environment cannot be read | `DISABLED` | `MISCONFIGURED` | `lead_rollout.config_unreadable` (error, error class only) |
| guard's reader throws | refused | — | `lead_rollout.guard_blocked`, `reason=CONFIG_READER_FAILED` (error) |
| guard's reader returns garbage | refused | — | `lead_rollout.guard_blocked`, `reason=CONFIG_MALFORMED`, `mode=UNKNOWN` (error) |

Every failure moves towards `DISABLED`. An `error`-level `guard_blocked` or `config_unreadable` is an unexpected enforcement failure and needs investigation even though it is safe.

## 6. Incident investigation — what exists

| Tool | What it gives | Notes |
|---|---|---|
| Structured JSON logs (`logger`, one object per line; redacts keys such as token, secret, password, authorization, cookie, session, credential) | The events in section 1 and the reused events | Aggregation/retention is outside the repository |
| `x-request-id` header (`request-id.ts`) | Route-level correlation (`requestId` on route events and cron events; returned in the response header) | Valid UUIDs from an upstream proxy are preserved, anything else is replaced |
| Admin lead console (`/admin/leads`, ADMIN/SUPER_ADMIN) | Lead list filtered by lead status and **purchase status** (including `PENDING_PAYMENT`) and date range; lead detail with a purchase/payment/claim/dispute timeline; claim and dispute queues; abuse flags | Read-only except the pinned M157 actions |
| `GET /api/health`, `/api/health/ready`, `/api/health/startup`, `/api/health/circuit-breakers`, `/api/health/diagnostics` (diagnostics is ADMIN-gated) | Instance and dependency health | None reports the rollout mode |
| Sentry (when `SENTRY_DSN` is configured) via the `ErrorReporter` port | Unexpected exceptions and the explicit `reportMessage` calls | Project/alert rules live in Sentry, not in the repository |
| OpenTelemetry tracing (`TRACING_ENABLED=true`, optional OTLP exporter) | Spans for HTTP routes, Prisma and outbound calls | Off by default |
| Reconciliation runs and discrepancy records (M80–M92, M152) | Ledger / invoice / credit-note consistency | CRITICAL discrepancies trigger the M90 alert path |

Correlation gap: route events carry `requestId` **and** the Stripe `eventId`; the use-case events carry `eventId`/`purchaseId` (opaque ids) but not `requestId`. Join route and use-case lines on `eventId` (webhooks) or `purchaseId`. A full request-id propagation into use cases would need a request-context mechanism that the repository does not have (see section 14).

## 7. Purchase and payment incidents

Investigate with logs and the admin console only. **Do not** edit `LeadPurchase` rows, replay payloads by hand or mark purchases manually in the database.

**Failed initiation** — look for `lead_fee_payment.denied` (field `reason`, optionally `eligibilityReason`), `lead_fee_payment.provider_failed` (field `category` for gateway errors), `lead_fee_payment.discard_failed`. A user-facing "not available right now" with `guard_blocked` nearby is the rollout switch, not a payment fault.

**Webhook delay or non-arrival** — a purchase stays `PENDING_PAYMENT` until the lead-fee webhook confirms it. Check that route events `stripe_payments_webhook_lead_fee_processed` are arriving; look for `stripe_payments_webhook_signature_invalid` (secret/endpoint mismatch) and `lead_fee_payment_webhook.reference_missing`, `lead_fee_payment_webhook.unmatched_payment`, `lead_fee_payment_webhook.rejected`. Delivery retries and redelivery are controlled in the Stripe Dashboard by an authorized person; the repository has no tool that re-pulls payments.

**Duplicate processing** — the webhook claims `(STRIPE_LEAD_FEE_PAYMENTS, event.id)` first; a repeated delivery returns outcome `duplicate` (HTTP 200, no reprocessing). Outcomes seen in the route event: `confirmed`, `already-confirmed`, `cancelled`, `payment-failed-observed`, `duplicate`, `unmatched`, `rejected`, `ignored`. Repeated `duplicate` for one `eventId` is normal Stripe retry behavior; a *burst* of `unmatched`/`rejected` is not. A processing exception marks the claimed event failed and returns 5xx so the provider retries.

**Stuck `PENDING_PAYMENT`** — accurate state of the codebase (see also M159 §9):

- A purchase created while PURCHASE was open stays `PENDING_PAYMENT` if the area is then closed. A **new** payment attempt cannot be started while closed (`InitiateLeadFeePaymentUseCase` is guarded); a payment attempt created earlier **can still complete**, and the webhook confirms it.
- **No automatic expiry, no timeout job, no operator command or admin action to cancel or expire a pending purchase was found in the repository.** The purchase remains pending until the area reopens or the payment resolves via the webhook (`payment_intent.canceled` / failure observation handled by the webhook use case).
- Operators can *find* such purchases: admin console → filter `purchaseStatus = PENDING_PAYMENT` with a date range. No age threshold is defined by the repository; any "stuck after N minutes" rule needs baseline data (section 12).
- No money has moved for a `PENDING_PAYMENT` purchase with no completed Stripe payment. Verify the payment state in Stripe before any statement to the professional. Do not invent a recovery step; escalate to engineering if a pending purchase must be resolved before the area reopens.

## 8. Refunds, disputes, credit notes and revocation — rollback invariant

Disabling new LEAD_V1 acquisition **must not** disable the following. This is enforced by construction (the guard is applied only in the eight composition-root factories of M159) and **verified by tests** (`lead-rollout-rollback-invariant-m160.test.ts`, `lead-rollout-boundary-m159.test.ts`, `lead-rollout-wiring-m159.test.ts`):

- Lead-fee payment webhook confirmation and its idempotency ledger.
- Chargeback/dispute webhooks, dispute evidence submission, purchase revocation (M155).
- Lead-fee refund execution, credit notes, invoices, document reconciliation (M149–M153).
- Quality claims — submit, review, decide (M154).
- Contact access for an already `CONFIRMED` buyer (M138; still subject to M139/M155/M158 rules).
- Single-lead preview and own-purchase checkout state.
- Admin console reads and the pinned admin mutations (refund/revoke/claim decisions/abuse blocks).
- Consent withdrawal and the retention cron (M158).

If any of these returns `LEAD_V1_ROLLOUT_DISABLED`, that is a defect: stop, do not "fix" it by changing the mode, and escalate to engineering.

## 9. Consent and retention incidents (M158)

- The retention job runs from Vercel Cron `GET /api/cron/lead-privacy-retention` (`20 4 * * *`, UTC) with `Authorization: Bearer $CRON_SECRET`; without `CRON_SECRET` it answers 503 (`lead_privacy_retention_cron_misconfigured`), a bad bearer 401 (`lead_privacy_retention_cron_unauthorized`).
- Failed phase: the route answers 500, logs `lead_privacy_retention.phase_failed` (field `phase`: `ERASED_CUSTOMER_REQUESTS`, `TERMINAL_REQUEST_MINIMIZATION`, `ROLLOUT_REPORT`, `AUDIT`), and reports "Lead privacy retention run completed with failures" to the error reporter. Another run holding the lock yields outcome `skipped_locked` (normal).
- `?dryRun=1` (authenticated) previews counts and writes nothing. Responses and logs carry counts and fixed enums only. The retention period is applied only when an approved period is configured (see M158); do not set one as part of an incident, and treat the lawful basis (D19) as an open legal decision.
- A failing consent withdrawal or retention run does not depend on the rollout mode and must not be "resolved" by changing it.
- Erasure/withdrawal evidence is personal data: do not copy lead text, contact details or consent evidence into tickets or chat.

## 10. Abuse and fraud incidents (M156)

- `LEAD_ABUSE_CONTROL_MODE` (OFF | SHADOW | FLAG | ENFORCE) is independent of the rollout mode and is not changed by this module. The rollout guard runs outside the abuse layer, so a refused call spends no abuse budget.
- Abuse-layer internal failures appear as `lead_abuse.*` error events (error class only). Abuse flags and decisions are reviewed in the admin console (abuse queue / subject view) by admins.
- Do not publish thresholds, rule keys or detection logic to users, and do not paste them into external tickets. Tell a blocked user only the generic message the product already shows. Never lift a block to "unstick" a rollout test.

## 11. Privacy-safe logging

Approved fields for M160-style events: event name, `area` (ENTRY | PURCHASE), effective `mode`, `configStatus`, a fixed `reason` enum, outcome labels, `phase`, counts, opaque ids that already exist in current events (`eventId`, `purchaseId`, `refundId`, `disputeId`), `requestId`, error class name.

Prohibited: raw environment values, secrets, tokens, `Authorization`/cookie data, raw webhook bodies and signatures, card or bank data, e-mail, phone, names, addresses, lead titles/descriptions, consent evidence, contact details, user ids as metric labels or free dimensions, and the arguments of a refused call. The logger redacts key names that look like secrets, but redaction is a safety net, not permission.

Incident evidence: quote event names and fixed fields; store log excerpts in the incident record, not screenshots of consoles that show personal data; never attach `.env*` content; follow the retention policy of the log system (not defined in this repository).

## 12. Alert matrix

**There is no alert provider in the repository** other than (a) Sentry reporting through the `ErrorReporter` port — alert *rules* live in the Sentry project and are not versioned here — and (b) the M90 CRITICAL reconciliation alert path (`alert-on-critical-discrepancy.subscriber.ts`, error reporter + audit log). No pager/Slack/e-mail alert integration, no metrics backend and no log-based alert rules exist in the repository. Nothing below is "active" unless an operator has configured it outside the repository. Thresholds are intentionally **not invented**: they require baseline data from staging/production.

| Signal | Source | Condition | Impact | First response | Escalation | Automated alerting exists? |
|---|---|---|---|---|---|---|
| Effective rollout not `DISABLED` unexpectedly | `lead_rollout.effective_mode` / admin banner | `mode != DISABLED` outside an approved rollout | New LEAD_V1 activity possible | Verify approval; if none, execute section 4 | Incident owner | No (log search only) |
| Rollout misconfigured | `lead_rollout.config_invalid` | any occurrence | Silent fallback to `DISABLED`; rollout not what operator intended | Fix variable, redeploy, verify | Platform owner | No |
| Rollout unreadable / enforcement failure | `lead_rollout.config_unreadable`, `guard_blocked` with `reason` ≠ `AREA_CLOSED` | any occurrence | Fails closed; users blocked | Check platform environment health, restart | Engineering | No (error-level log; Sentry only if the log pipeline forwards it — not wired) |
| Guard blocks while rollout is meant to be open | `guard_blocked` with `AREA_CLOSED` in an open area for that mode | any occurrence in a staged rollout | Users blocked unexpectedly | Compare mode vs area; verify all instances restarted | Incident owner | No |
| Webhook signature failures | `stripe_payments_webhook_signature_invalid` | any sustained occurrence (rate: requires baseline) | Payments not confirmed | Check endpoint secret/URL with the authorized Stripe admin | Engineering | No |
| Unmatched / rejected lead-fee payments | `lead_fee_payment_webhook.unmatched_payment`, `.rejected` | any occurrence | Possible money without a confirmed purchase | Investigate by `eventId`; check Stripe; no manual DB edits | Finance + engineering | No (error-level logs only) |
| Stuck `PENDING_PAYMENT` | Admin console filter `purchaseStatus=PENDING_PAYMENT` | age threshold: **requires baseline data** | Professional waiting, no contact access | Check Stripe payment state; check webhook flow | Engineering | No (no job detects it) |
| Provider failure on initiation | `lead_fee_payment.provider_failed` | rate: **requires baseline data** | Professionals cannot pay | Check Stripe status / circuit breakers | Engineering | No |
| Refund outcome unknown / mismatch | `Lead-fee refund …` error lines | any occurrence | Refund state needs reconciliation by re-running the use case | Follow M153 reconcile-by-rerun; no manual DB edits | Finance + engineering | No |
| Dispute anomalies | `lead_fee_dispute_webhook.unmatched_payment`, `lead_fee_dispute_webhook.rejected` | any occurrence | Revocation/consequences may be wrong | Investigate by `disputeId`/`eventId` | Finance + engineering | No |
| Retention job failure | `lead_privacy_retention.phase_failed`; cron HTTP 500 | any occurrence | Erasure follow-through delayed | Re-run via scheduler or authenticated GET; read counts | Privacy owner + engineering | Partial: error reporter message (Sentry, if configured) |
| Retention cron misconfigured | `lead_privacy_retention_cron_misconfigured` (503) | any occurrence | Job not running | Set `CRON_SECRET` | Platform owner | No |
| CRITICAL reconciliation discrepancy | M90 subscriber | new CRITICAL discrepancy | Money/invoice inconsistency | Follow reconciliation docs (M80–M92) | Finance + engineering | Yes, via error reporter (delivery depends on Sentry config) |

Dependencies before automated alerting is possible: a log pipeline with alert rules (or a metrics backend), Sentry alert rules for the tags above, and a notification channel. None is a repository decision today.

## 13. Recovery and post-incident review

1. Validate state: effective mode as intended (section 3); webhook events processing; no `error`-level rollout events; pending purchases reviewed in the console.
2. Re-open only with the same approvals as the original rollout; staged order `ENTRY_ONLY` → `ENABLED` (M159 §12). Never skip straight to production.
3. Evidence to retain: event names/time ranges, request/event ids, the mode change record (who, when, from/to), Stripe-side outcomes by id. No personal data, no environment dumps.
4. Follow-ups: open items for any gap hit during the incident (section 14); update this runbook with what was learned; decide thresholds once baselines exist.

## 14. Known gaps and dependencies

Implemented and tested: guard-block event, boot-time effective-mode line, no-leak and logging-failure-isolation tests, rollback-invariant tests, runbook-vs-code consistency tests.

Documentation-only / missing infrastructure:

- No metrics backend; no counters. The events are logs. No claim of metrics is made.
- No alert provider, no pager/Slack/e-mail integration, no log-based alert rules, no Sentry alert rules in the repository.
- `guard_blocked` is one line per refused call and is **not** sampled or de-duplicated (module-level state is forbidden by the M159 boundary test and per-call factories have no shared instance). Refused professional feed loads while PURCHASE is closed can therefore be frequent; the volume baseline is unknown. Tune with log-pipeline filtering until a baseline exists.
- The block event reports the **area** (ENTRY | PURCHASE), not the individual operation; the operation is visible from the surrounding route/request logs.
- Request-id propagation into use cases is not implemented (no request-context mechanism); join on `eventId`/`purchaseId`.
- No automatic expiry or operator tool for `PENDING_PAYMENT`; no monitor for their age.
- Publication and purchase-initiation domain failures are returned to the caller as expected errors and are not individually logged (to avoid noise and avoid paging on expected rejections). Unexpected exceptions go to the error reporter via the existing mechanisms.
- `LOG_LEVEL` above `info` suppresses `lead_rollout.effective_mode` and the `AREA_CLOSED` block events.
- Which deployment platform is production is not stated in the repository (Vercel cron config and a Docker path both exist).
- Database-backed integration tests (`npm run test:integration:db`) were not run for this module (see the completion report) and no schema or query changed.

## 15. Pre-Gate-B operational checklist

M160 does not approve Gate B. Before M161 and Gate B (per M159 §10 and the roadmap):

- [ ] M161 complete and green: every mode and every row of the M159 operation matrix end to end; webhook live while PURCHASE closed; concurrency on real PostgreSQL.
- [ ] Kill switch (section 4) **rehearsed in staging**, including verification via `lead_rollout.effective_mode`.
- [ ] Alerts firing in staging — requires an alert provider and rules that do not exist yet (section 12, 14).
- [ ] Baselines collected so that thresholds in section 12 can be set from evidence.
- [ ] Legal decisions closed with advisor confirmation: D1, D12, D14, D15, D16, D17, **D19** (lawful basis for contact sharing), **D20**, and M153/D12 (refund execution). This module decides none of them.
- [ ] **D21 pilot cohort defined** (region/professional cohort). Not invented here; the per-region and per-professional controls anticipated for M159 remain deferred until D21 is decided.
- [ ] Real issuer legal name/CIF configured; `LEAD_PRICING_CONFIG_VERSION` released; `LEAD_CONTACT_SHARING_BASIS` decided; `LEAD_ABUSE_CONTROL_MODE` reviewed (SHADOW before ENFORCE); invoice and credit-note approval references set.
- [ ] Ledger, invoices, credit notes and reconciliation clean over a rehearsed period.
- [ ] Runbooks rehearsed by the operators who will use them.
- [ ] Production rollout remains `DISABLED` until an authorized operator explicitly configures otherwise.

## 16. Tests

`tests/unit/core/application/use-cases/lead-rollout/lead-rollout-observability-m160.test.ts` (event content, no leakage, no noise on pass-through, logging failure isolation) · `tests/unit/core/application/use-cases/lead-rollout/lead-rollout-rollback-invariant-m160.test.ts` (real composition-root wiring: no guard on webhook/dispute/refund/credit-note/claim/retention/consent factories in any mode) · `tests/unit/prisma/lead-rollout-observability-boundary-m160.test.ts` (static: no new env reads, no sensitive fields in rollout logging, instrumentation line value-free, runbook names match code). The M159 test files remain unchanged and green.
