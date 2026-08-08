# Module 49 — SMS Notifications

## 1. Goal

Give the platform a fully event-driven SMS delivery channel — provider-agnostic, retried, observable, localized — that composes alongside the existing `IN_APP`/`EMAIL`/`WEB_PUSH`/`REALTIME` notification channels (Module 32) rather than replacing or duplicating any of them.

This module introduces no new source of truth and no new delivery guarantee beyond what Module 45 (Background Jobs) already provides platform-wide: an SMS is queued, retried with backoff, and dead-lettered if the provider keeps failing — exactly the same contract search indexing and queued domain-event dispatch already have. Nothing in the application layer imports a concrete SMS provider; `TwilioSmsSender` and `MockSmsSender` are the only two classes in the codebase that know Twilio exists.

## 2. Architecture

### 2.1 Layering

```
application/interfaces/
  sms-sender.ts                  (SmsSender, SmsMessage — the provider port)

application/ports/
  notification-channel.ts        ("SMS" added to NOTIFICATION_CHANNELS; phone/locale added to the payload)
  notification-service.ts        (phone/locale added to NotificationRequest)
  notification-creator.ts        (phone/locale added to NotificationEvent)
  sms-queue.ts                   (SmsQueue, SmsDispatchRequest — the enqueue seam)

application/use-cases/notification/
  notify-dispute-created-sms.subscriber.ts  (event-driven SMS demo — see §4)

infrastructure/sms/
  twilio-sms-sender.ts           (SmsSender over Twilio's REST API — fetch, no new SDK dependency)
  mock-sms-sender.ts             (in-memory SmsSender — SMS_PROVIDER=mock, the default)
  sms-sender-factory.ts          (createSmsSender() — selects mock|twilio from env)
  sms-message-catalog.ts         (SMS_MESSAGE_CATALOG — static per-locale template imports)
  sms-template-renderer.ts       (renderSmsTemplate() — {variable} substitution)
  sms-template-mapping.ts        (NotificationTypeValue -> SmsTemplateKey, buildSmsBody())
  sms-jobs.ts                    (SMS_DISPATCH_QUEUE_NAME, job id / idempotency key)
  sms-queue-adapter.ts           (SmsQueue over a Module 45 Queue)
  sms-dispatch-job-processor.ts  (the Worker's JobProcessor — renders + calls SmsSender)
  sms-health.ts                  (SmsProviderHealthReport, collectSmsProviderHealth())
  compose.ts                     (composition root: queue/worker/health, all lazy)

infrastructure/notifications/channels/
  sms-notification-channel.ts    (SmsNotificationChannel — a real NotificationChannelAdapter)

infrastructure/notifications/
  notification-dispatcher.compose.ts  (SmsNotificationChannel registered alongside the other four)

infrastructure/config/
  env.ts                         (SMS_PROVIDER, TWILIO_ACCOUNT_SID/AUTH_TOKEN/FROM_NUMBER)

i18n/messages/{locale}/sms.json  (10 locales — es/en/uk/cs/de/fr/it/pt/ro/pl)

app/api/health/ready/route.ts    (checks.smsProvider)
```

### 2.2 Why this shape

`SmsSender` mirrors `EmailSender` (`application/interfaces/email-sender.ts`) exactly: a one-method port, two implementations, dependency inversion enforced by import boundaries (nothing under `application/` or `domain/` imports `infrastructure/sms/*`). `SmsNotificationChannel` mirrors `EmailNotificationChannel` in the same way, and is registered into the exact same `NotificationDispatcher` every other channel goes through — `SMS` composes with `IN_APP`/`EMAIL`/`WEB_PUSH`/`REALTIME`, it does not gate or replace any of them.

The one structural difference from `EmailNotificationChannel`: `SmsNotificationChannel.send()` never calls a provider directly. It only enqueues onto `SmsQueue`, the application-layer seam whose only real implementation (`SmsQueueAdapter`) sits on top of a Module 45 `Queue`. This is deliberate and is the same rule Module 47 (CQRS Search Engine) enforces for search indexing: the platform's default `SynchronousEventBus`/`NotificationDispatcher` call path runs a channel adapter's `send()` inline, inside the HTTP request that triggered the notification. An adapter that called Twilio directly would put a live network call on that request's critical path and would fail (or slow) it whenever Twilio is briefly slow or down. Enqueuing keeps the request path local and fast; the actual `SmsSender.send()` call — with retries, exponential backoff + jitter, and dead-lettering — happens later, in the `sms-dispatch` background worker (`infrastructure/sms/sms-dispatch-job-processor.ts`), using **Module 45's existing retry machinery**, not a second one invented for this module.

`infrastructure/sms/compose.ts` builds the queue and worker lazily (`getSmsQueue()`), for the identical two reasons `infrastructure/search/compose.ts` documents: Next.js imports every module during `next build` for static analysis, where constructing a worker (which polls) would be wrong; and `notification-dispatcher.compose.ts` must stay importable — and every non-SMS channel must keep working — in a process that never sends a single SMS. `deferredSmsQueue` is the one-line indirection that keeps this laziness honest across the import boundary.

## 3. Templates & localization

`sms.json` is a **new, separate i18n namespace**, not folded into Module 29's shared `NAMESPACES`/`MESSAGE_CATALOG` (`infrastructure/i18n/message-catalog.ts`). Two reasons, both load-bearing:

1. **Different rendering engine.** The shared catalog is rendered by next-intl's ICU `createTranslator` — built for UI copy (plurals, `{date, date, medium}` formatters). An SMS body is plain text with a handful of already-formatted values and a hard length budget; `sms-template-renderer.ts` uses a small hand-rolled `{variable}` substitution instead (see that file's own doc comment).
2. **Different completeness contract.** Module 29's `messages-completeness.test.ts` renders every shared-catalog message against one fixed ICU argument set (`name`/`language`/`count`/`min`/`max`/`year`/`date`). This module's templates need their own argument names (`code`, `amount`, `caseNumber`, `status`, `preview`, `time`) that don't belong in that shared set. This module ships its own completeness test instead (`tests/unit/core/infrastructure/sms/sms-template-renderer.test.ts`), scoped to exactly the `sms` catalog, holding it to the same bar: every supported locale, every key, no empty strings, every placeholder resolvable.

All **10 supported locales** (`es`/`en`/`uk`/`cs`/`de`/`fr`/`it`/`pt`/`ro`/`pl` — `shared/i18n/locales.ts`) ship real, hand-written translations, matching the coverage every other notification-facing namespace (`notifications.json`, `emails.json`) already has.

Templates cover the module brief's full requested set:

| Template key | Wired from | Variables |
|---|---|---|
| `bookingConfirmed` | `APPOINTMENT_CONFIRMED` | `name`, `date` |
| `appointmentReminder` | `APPOINTMENT_PROPOSED` | `date`, `time` |
| `professionalAssigned` | `JOB_STARTED` | `name` |
| `quoteAccepted` | `QUOTE_ACCEPTED` | `amount` |
| `quoteRejected` | `QUOTE_REJECTED` | — |
| `serviceRequestUpdated` | `SERVICE_REQUEST_EXPIRED`, `QUOTE_EXPIRED` | `status` |
| `chatNotification` | `NEW_MESSAGE` | `name`, `preview` |
| `disputeNotification` | `DISPUTE_CREATED`, `DISPUTE_ASSIGNED`, `DISPUTE_STATUS_CHANGED` | `caseNumber` |
| `passwordReset` | *(future-ready — see §7)* | `code` |
| `phoneVerification` | *(future-ready — see §7)* | `code` |
| `twoFactorAuthentication` | *(future-ready — see §7)* | `code` |

`infrastructure/sms/sms-template-mapping.ts`'s `SMS_TEMPLATE_BY_NOTIFICATION_TYPE` owns this mapping. A `NotificationTypeValue` with no entry — and every job whose `metadata` is missing a placeholder its mapped template needs — never throws: `buildSmsBody()` falls back to the channel-agnostic `fallbackMessage` (truncated to `SMS_SINGLE_SEGMENT_LIMIT`, 160 chars) or leaves the placeholder literal, respectively. A partially-useful or generic SMS is always preferred over a dead-lettered job.

## 4. Event flow

```
DisputeCreated (domain event, published by CreateDisputeUseCase)
        │
        ├─▶ NotifyDisputeCreatedSubscriber          (Module 37, unchanged)
        │       → NotificationCreator.notify({ channels: ["IN_APP","REALTIME"] })
        │
        └─▶ NotifyDisputeCreatedSmsSubscriber        (Module 49, new)
                → resolves phone + locale via UserRepository
                → NotificationCreator.notify({ channels: ["SMS"], phone, locale })
                        → NotificationServiceCreator → NotificationDispatcher
                                → SmsNotificationChannel.send()
                                        → SmsQueue.enqueue()  [returns immediately]
                                                → sms-dispatch Queue (Module 45)
                                                        → Worker → SmsSender.send()
```

`NotifyDisputeCreatedSmsSubscriber` is registered as a **second, independent** `eventBus.subscribe(DisputeCreated, ...)` call in `application/use-cases/notification/compose.ts`, alongside the pre-existing `IN_APP`/`REALTIME` subscriber — not an edit to that class. `EventBus.subscribe()`'s own contract ("multiple handlers may subscribe to the same event type; all of them run") is what makes this safe: the existing subscriber, its registration, and its unit test are completely untouched.

**Why `DisputeCreated` and not the module brief's literal event names** (`BookingCreated`, `AppointmentScheduled`, `QuoteAccepted`, `ProfessionalAssigned`, `PasswordResetRequested`): none of these exist as domain events in this codebase today (`src/core/domain/events/` — confirmed by direct inspection). The corresponding flows (`AcceptQuoteUseCase`, `RequestPasswordResetUseCase`, etc.) either call `NotificationCreator` directly (not through the event bus) or send email directly, bypassing the notification pipeline entirely. `DisputeCreated` is this codebase's best-fit **existing** domain event for end-to-end demonstration: time-sensitive, requires a response, and already flows through `eventBus.subscribe()` exactly like the module brief's instruction ("go through the SAME event bus subscription mechanism already used for existing notifications") requires. Wiring SMS onto a *non-existent* event, or bypassing the event bus to reach `AcceptQuoteUseCase` directly, would have violated the module's own "do not call the SMS provider directly from use-cases" constraint.

Every other template (`bookingConfirmed`, `quoteAccepted`, `passwordReset`, ...) is fully implemented, tested, and ready to be called by a future subscriber the moment its underlying domain event exists — no change to this module's own files is needed then, only a new subscriber + registration, exactly mirroring `notify-dispute-created-sms.subscriber.ts`.

## 5. Retry, idempotency & delivery status

Reuses Module 45's `Queue`/`Worker` unmodified:

- **Enqueue-time de-duplication** — `smsDispatchJobId()` keys on `type:userId:resourceId` when a `resourceId` is available (the common case — a dispute, a quote), so a notification retried within the same request collapses into one job. With no `resourceId`, a random suffix is used — this forgoes enqueue-time de-duplication for that one send rather than risk collapsing two unrelated notifications (e.g. two different chat messages) that share a type and no resource id.
- **Execution-time idempotency** — `smsDispatchJobIdempotencyKey()` is keyed on the job's own id (stable across retries), recorded in the shared `JobIdempotencyStore` only after a successful send.
- **Retries** — exponential backoff from 1s with 20% jitter (`SmsQueueAdapter`'s configured `JobOptions`), `QUEUE_MAX_ATTEMPTS` attempts (shared `env.QUEUE_MAX_ATTEMPTS`), identical to the search-indexing queue's own policy.
- **Delivery status** — an exhausted job is moved to `sms-dispatch-dead-letter` with its full payload (recipient phone included — see §8 for why that's an accepted, documented trade-off) and reported through `JobLifecycleObserver` (`logger.error` + `createErrorReporter().reportException`), the same path every other dead-lettered job in this codebase uses. There is no separate "delivery receipt" concept: Twilio's asynchronous status callbacks are out of scope for this module (see §7).

## 6. Configuration

```
SMS_PROVIDER="mock"        # mock | twilio — defaults to mock; never fails startup on a typo
TWILIO_ACCOUNT_SID=""
TWILIO_AUTH_TOKEN=""
TWILIO_FROM_NUMBER=""
```

All three Twilio variables are optional at the schema level (mirroring `MAPBOX_API_KEY`/`GEOCODING_PROVIDER`'s "a provider that isn't selected is never a startup requirement" precedent) but required — enforced by `env.ts`'s `.superRefine`, the same block that enforces `SENTRY_DSN` in production — whenever `SMS_PROVIDER=twilio` in production. `createSmsSender()` throws the identical error at construction time in every environment, so a misconfigured `twilio` selection fails loudly rather than silently no-op-sending.

`TwilioSmsSender` calls Twilio's REST API with `fetch` and HTTP Basic Auth, not the `twilio` npm SDK — see that class's own doc comment for why this is a deliberate departure from `ResendEmailSender`'s choice to add `resend` as a real dependency (Twilio's Messages API is one endpoint; adding an entire SDK for it would be the heavier choice for no behavioral benefit).

## 7. Future work (explicitly out of scope for this module)

- **Phone verification / 2FA flows.** `phoneVerification`/`twoFactorAuthentication` templates are fully implemented and tested; there is no phone-verification or 2FA use case anywhere in this codebase to call them yet. A future module wires a use case that calls `renderSmsTemplate("phoneVerification", locale, { code })` and `SmsSender.send()` (or, better, enqueues through `SmsQueue` the same way this module does) — no change to this module's files required.
- **Password reset over SMS.** `RequestPasswordResetUseCase` sends its reset link by email only, unchanged by this module. `passwordReset`'s template exists for the same future-readiness reason as above.
- **Delivery status callbacks.** Twilio's asynchronous `StatusCallback` webhook (delivered/failed/undelivered) is not implemented — this module's "delivered" is "the Twilio API call returned 2xx", not "the handset confirmed receipt". A future module could add a webhook route and a `SmsDeliveryStatus` read model without touching the dispatch path this module owns.
- **Opt-out/consent (STOP/HELP) handling.** Not implemented. A production Twilio number can handle STOP compliance at the carrier/Twilio level today; a per-user SMS-consent flag is a reasonable follow-up but was out of this module's scope.

## 8. Observability & PII

Sent/failed/retried counts and provider latency are visible through the exact same seams every other job type in this codebase already reports through: `JobLifecycleObserver` (`logger.*` + Sentry via `createErrorReporter()`), no new logger, no new metrics system. `checks.smsProvider` in `/api/health/ready` reports the configured provider, whether it's fully configured, and the `sms-dispatch`/`sms-dispatch-dead-letter` queue counts — visibility-only, exactly like `checks.queue`/`checks.searchEngine`/`checks.realtime`: a degraded or misconfigured SMS provider never flips the route's overall `status` or HTTP code, since it can't be this instance's failure to serve HTTP traffic.

Dead-lettered SMS jobs carry the recipient's phone number in their payload, same as every other dead-lettered job in this codebase carries whatever PII its own payload has (an email address, a user id) — no field in this platform's job payloads is redacted before dead-lettering today. This is an accepted, pre-existing trade-off this module does not change; a future audit of dead-letter payload retention/redaction would apply platform-wide, not to SMS specifically.

## 9. Testing

- **Unit** — `tests/unit/core/infrastructure/sms/`: `mock-sms-sender`, `twilio-sms-sender` (fetch mocked), `sms-sender-factory` (provider selection + fail-fast), `sms-template-renderer` (10-locale completeness + rendering), `sms-template-mapping` (type→template mapping, fallback truncation), `sms-jobs` (job id / idempotency key). Plus `sms-notification-channel.test.ts` (no-phone no-op, enqueue-failure swallowing) and `notify-dispute-created-sms.subscriber.test.ts` (phone/locale resolution, per-recipient failure isolation).
- **Integration** — `tests/integration/sms/sms-dispatch-pipeline.test.ts`: the full `DisputeCreated → subscriber → NotificationDispatcher → SmsNotificationChannel → Queue → Worker → SmsSender` path, mirroring `tests/integration/search/search-indexing-pipeline.test.ts`'s structure — no synchronous send on the publish path, retry-then-dead-letter on a failing provider, execution-time idempotency.
- **env.ts** — extended `tests/unit/core/infrastructure/config/env.test.ts` with `SMS_PROVIDER`/Twilio-credential cases (default, invalid-value fallback, production hard-fail, production pass).
- **Health route** — extended `tests/integration/observability/health-routes.test.ts` to assert `checks.smsProvider` is present and healthy under the default configuration.

## 10. Production readiness checklist

- [x] `SMS_PROVIDER=mock` works out of the box in every environment (dev/CI/prod-without-Twilio) — no outbound network call is ever made unless `twilio` is deliberately, validly selected.
- [ ] A real Twilio account (`TWILIO_ACCOUNT_SID`/`TWILIO_AUTH_TOKEN`/`TWILIO_FROM_NUMBER`) must be provisioned and set before switching `SMS_PROVIDER=twilio` in production — `env.ts` refuses to start otherwise.
- [ ] No database migration is required — `User.phone`/`User.phoneVerifiedAt` already existed in `prisma/schema.prisma` before this module.
- [ ] Delivery-status callbacks and opt-out handling remain future work (§7) before this module could be considered a complete SMS compliance story for a jurisdiction that requires them.
