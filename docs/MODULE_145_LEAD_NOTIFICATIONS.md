# Module 145 — LEAD_V1 Lead Notifications

M145 adds the notification layer for the LEAD_V1 marketplace flow **on top of the notification
architecture that already existed** (Modules 15/32/37/41/48/120). It introduces no new notification
platform, queue, outbox, webhook or state machine.

## What already existed (reused)

| Concern | Existing mechanism |
| --- | --- |
| Persistence / read | `Notification` table (Module 15), `/notifications` page + Server Actions (user-scoped) |
| Delivery | `NotificationCreator` port -> `NotificationServiceCreator` -> channel-agnostic `NotificationDispatcher` (IN_APP, REALTIME, EMAIL, SMS, WEB_PUSH stub) |
| Events | `EventBus` (synchronous by default, queue-backed with `EVENT_QUEUE_ENABLED`), `DomainEvent` subclasses, `Notify*Subscriber` registered from `notification/compose.ts` |
| i18n | `notificationTemplates.<TYPE>` in all 12 locales, rendered at read/delivery time with metadata arguments (`localizeNotification`) |
| Webhook idempotency | `external_webhook_events` ledger (M141 uses provider `STRIPE_LEAD_FEE_PAYMENTS`) |
| Preferences | none for notifications (only `User.preferredLocale`) |

## Events that notify (and why only these)

| Business fact | Authoritative owner | Recipient (server-resolved) | Type |
| --- | --- | --- | --- |
| Lead published (DRAFT -> PUBLISHED) | M133 `PublishLeadUseCase` (only the call that won the conditional write) | request's customer | `LEAD_REQUEST_PUBLISHED` |
| Purchase CONFIRMED | M141 webhook (verified `payment_intent.succeeded`, snapshot-validated) | buying professional | `LEAD_PURCHASE_CONFIRMED` (also the single "contact access available" notice — M138 derives access from CONFIRMED, same instant) |
| Purchase CONFIRMED | same | request's customer | `LEAD_PURCHASED` |
| Purchase CANCELLED | M141 webhook (verified `payment_intent.canceled` on PENDING_PAYMENT) | buying professional | `LEAD_PURCHASE_CANCELLED` |

Deliberately **not** implemented:

* *Payment failed* — `payment_intent.payment_failed` is non-terminal at Stripe (the same PaymentIntent
  can still succeed) and M141 leaves the purchase untouched; the checkout UI already shows the failure.
  Nothing authoritative to notify about; nothing is raised (tested).
* *Professional "new relevant lead"* — a fan-out to every eligible professional needs matching,
  throttling and preferences; the M134 feed is the discovery surface. Deferred.
* *Customer "lead closed/unavailable"* — M130 propagates closure inside the ServiceRequest status
  transaction at the database layer; there is no application boundary to hook, and expiry already has
  `SERVICE_REQUEST_EXPIRED`. Deferred.
* *Email* — no notification preference/opt-out model exists, so lead notifications use the platform
  default channels (in-app + realtime). The EMAIL channel stays available to a future module.

## Event ownership

The events (`LeadPublished`, `LeadPurchaseConfirmed`, `LeadPurchaseCancelled`) are raised only by the
two authoritative use cases, optionally (a `Pick<EventBus,"publish">` constructor argument; every
pre-M145 construction is unchanged), best-effort (a failing subscriber is logged and never changes the
publication or webhook outcome). They carry **only an id**. The checkout page, payment initiation, any
Server Action, component or polling cannot raise them (static contract test).

## Idempotency

* `Notification.dedupeKey` (nullable `VARCHAR(191)`) + unique `(userId, dedupeKey)`; keys look like
  `lead-v1:purchase-confirmed:<purchaseId>:professional`. NULL keys (all pre-M145 rows and all legacy
  callers) are unconstrained.
* `PrismaNotificationRepository.createIfAbsent` is `INSERT … ON CONFLICT DO NOTHING`: concurrent and
  repeated callers produce exactly one row; replays are silent and never overwrite.
* The dispatcher treats IN_APP as the ledger: when a `dedupeKey` is present IN_APP runs first, a
  `DUPLICATE` outcome skips every other channel, and an IN_APP failure sends nothing else.
* M141: a duplicate Stripe event id is stopped by the ledger; a *new* delivery that observes the
  purchase already CONFIRMED re-raises the event (this heals a notification lost to a transient
  failure) and the per-recipient key keeps it exactly-once.

## Recipient authorization and privacy

Subscribers re-read the persisted relations (`PrismaLeadNotificationContextReader`:
purchase -> lead -> request -> customer -> user, purchase -> professional -> user), require the right
purchase/lead status, and return nothing for non-LEAD_V1 flows. Recipients never come from an event
payload, client input, URL, or M138 data. Content is generic and localized; the only argument is the
public-granularity `city`. No name/phone/email/address/title/description, no price, no Stripe or
payment reference, no purchase id appears in any user-visible field; the professional's link contains
the lead id (already used by the marketplace URLs) and the customer's contains their own request id.

## Schema

`prisma/migrations/20261011000000_add_module_145_lead_notifications`: four `NotificationType` values,
one nullable column, one unique index. Additive only.
