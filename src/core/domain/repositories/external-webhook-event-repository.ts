/**
 * Module 70.1 — Pre-Stripe Security & Integration Hardening (Objective C):
 * a reusable, provider-independent external-event idempotency mechanism.
 *
 * This is the one seam any inbound webhook route in this codebase — the
 * new `/api/webhooks/persona` today, a future `/api/webhooks/stripe`
 * tomorrow, any other provider later — depends on to guarantee "the same
 * external event delivered twice produces no duplicate side effect,"
 * including when two duplicate deliveries arrive concurrently. Deliberately
 * narrow and storage-shaped (no `Entity<Props>` subclass), matching this
 * codebase's existing repository-interface convention, and deliberately
 * provider-agnostic: `provider` is a free-form string, not an enum tied to
 * Persona/Stripe — adding a third provider later needs no interface change
 * here.
 *
 * ## Why this guarantees the invariant under concurrency
 * `(provider, externalEventId)` is a DB-level unique constraint (see
 * `PrismaExternalWebhookEventRepository.claim` and the
 * `external_webhook_events` table's migration) — application-level
 * "check then insert" logic alone is not sufficient for money/KYC-sensitive
 * operations (Module 70.1's own security requirement): two concurrent
 * requests racing a plain `findFirst` + `create` could both observe "not
 * found" and both proceed. `claim()` instead always attempts the `create`
 * first and lets the database's unique index be the single source of
 * truth for "was this event already seen" — only one concurrent caller can
 * ever win that insert.
 *
 * ## Retry semantics
 * A `FAILED` event (its processing use case threw after `claim()`
 * succeeded — see `markFailed`) may be re-claimed by a later delivery,
 * since Persona/Stripe/etc. all retry webhook delivery on a non-2xx
 * response. A `PROCESSING` or `PROCESSED` event may never be re-claimed —
 * `PROCESSING` means another delivery (possibly concurrent) already owns
 * it, `PROCESSED` means the side effect already happened. Both cases
 * return `claimed: false` so the caller acknowledges the webhook (HTTP 200)
 * without re-running the use case, which is what actually stops the
 * provider's retry loop rather than making it worse.
 */
export type ExternalEventProcessingStatus = "PROCESSING" | "PROCESSED" | "FAILED";

export interface ExternalWebhookEventRecord {
  id: string;
  /** Free-form provider name — `"PERSONA"` today, `"STRIPE"` (or any
   *  other provider) later. Never a Persona/Stripe-specific type. */
  provider: string;
  /** The provider's own unique identifier for this specific delivery/event
   *  — Persona's `Event.id`, Stripe's `Event.id` — never this platform's
   *  own id for anything. */
  externalEventId: string;
  /** The provider's own event-type/name string, kept only for
   *  observability — never branched on for a security or idempotency
   *  decision (uniqueness is `(provider, externalEventId)` alone). */
  eventType: string | null;
  status: ExternalEventProcessingStatus;
  processedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ClaimExternalWebhookEventInput {
  provider: string;
  externalEventId: string;
  eventType?: string | null;
}

export interface ClaimExternalWebhookEventResult {
  /** `true` only when THIS call is the one that may proceed to process the
   *  event (a first delivery, or a retry of a previously `FAILED` one) —
   *  see this interface's own doc comment for the full state table. */
  claimed: boolean;
  record: ExternalWebhookEventRecord;
}

export interface ExternalWebhookEventRepository {
  /** Atomically claims `(provider, externalEventId)` for processing —
   *  DB-unique-constraint-backed, safe under concurrent duplicate
   *  delivery. See this file's own doc comment for the full state table. */
  claim(input: ClaimExternalWebhookEventInput): Promise<ClaimExternalWebhookEventResult>;
  /** Marks a claimed event as successfully processed — never re-claimable
   *  after this. */
  markProcessed(id: string): Promise<ExternalWebhookEventRecord>;
  /** Marks a claimed event as failed — re-claimable by a later delivery
   *  (the provider's own retry), see this file's own doc comment. */
  markFailed(id: string): Promise<ExternalWebhookEventRecord>;
}
