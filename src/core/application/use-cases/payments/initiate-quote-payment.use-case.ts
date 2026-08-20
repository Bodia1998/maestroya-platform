import { randomUUID } from "node:crypto";

import { calculateQuoteTotal } from "@/domain/services/money";
import { NotFoundError, ValidationError } from "@/domain/errors/domain-error";
import type { DistributedLock } from "@/application/ports/distributed-lock";
import type { PaymentGateway } from "@/application/ports/payment-gateway";
import type { CustomerProfileRepository } from "@/domain/repositories/customer-profile-repository";
import type { JobRepository } from "@/domain/repositories/job-repository";
import { ACTIVE_PAYMENT_STATUSES } from "@/domain/repositories/payment-repository";
import type { PaymentRepository, PaymentStatusValue } from "@/domain/repositories/payment-repository";
import type { QuoteRepository } from "@/domain/repositories/quote-repository";
import type { FeatureFlagEvaluationContext } from "@/domain/entities/feature-flag";
import type { FeatureFlagService } from "@/application/services/feature-flags/feature-flag-service";

/** Module 73's kill switch — see `feature-flag-definitions.ts`'s own doc
 *  comment for the full "why this flag, and only this use case" story. */
export const CUSTOMER_PAYMENT_CAPTURE_FLAG_KEY = "customer-payment-capture";

/** `DistributedLock.withLock`'s own doc comment calls out
 *  "`ttlMs` comfortably longer than `fn`'s expected duration" — a single
 *  Stripe `paymentIntents.create` call plus one DB upsert comfortably
 *  finishes in well under a second in the normal case; 15s is a generous
 *  safety margin against a slow Stripe response, not a tuned SLA. */
const PAYMENT_INITIATION_LOCK_TTL_MS = 15_000;

export interface InitiateQuotePaymentResult {
  paymentId: string;
  /** The Stripe PaymentIntent `client_secret` the customer's browser needs
   *  to complete card confirmation via Stripe.js — see
   *  `PaymentAuthorizationResult.clientSecret`'s own doc comment. Never
   *  logged, never persisted (Stripe itself is the only source of truth
   *  for it; a caller that needs it again after this response can simply
   *  re-call this use case, which is idempotent — see this class's own
   *  doc comment). */
  clientSecret: string | null;
  amount: number;
  currency: string;
}

/**
 * Module 73 — Real Customer Payment Capture.
 *
 * The single entry point for "the customer wants to pay for their accepted
 * Quote/Job." Implements the exact flow the module brief specifies:
 *
 *   Accepted Quote -> customer initiates payment -> server validates
 *   ownership -> server loads the authoritative Quote/Job -> server
 *   recomputes the payable amount -> Stripe PaymentIntent created (manual
 *   capture) -> Payment persisted.
 *
 * Nothing past this point (the customer confirming their card, Stripe
 * authorizing/capturing the charge) happens inside this use case — see
 * `ProcessCustomerPaymentWebhookUseCase` for the rest of the lifecycle,
 * driven entirely by Stripe's own webhook events, never by a second call
 * into this class.
 *
 * ## Authorization / IDOR
 * `jobId` is never trusted as proof of ownership just because it was
 * passed in — `userId` always comes from the server-side session (see the
 * calling Server Action's `requireAuth()`), and every step below
 * re-derives ownership from that session's own `CustomerProfile`, the
 * exact same "a Job/Quote that exists but isn't the caller's own surfaces
 * as the same `NotFoundError` as one that doesn't exist at all" convention
 * `AcceptQuoteUseCase` already establishes.
 *
 * ## Server-side amount authority
 * The payable amount is never accepted as a parameter to this use case at
 * all — there is no `amount` argument to trust or not trust. It is always
 * recalculated from the authoritative, server-loaded Quote's own line
 * items via `calculateQuoteTotal` (`domain/services/money.ts`) — the exact
 * same pure function `CreateQuoteUseCase`/`UpdateQuoteUseCase` already use
 * to compute `Quote.totalAmount` in the first place, so this is not a
 * second, potentially-divergent pricing formula, just the same one
 * re-applied defensively at payment time rather than trusting the
 * previously-persisted `totalAmount` column.
 *
 * ## Idempotency — three independent layers
 * 1. **Application-level lock**: the entire "check, create PaymentIntent,
 *    persist" sequence runs inside `DistributedLock.withLock`, keyed on
 *    the Quote being paid — two concurrent calls for the same Quote never
 *    execute this sequence truly concurrently on a single process/cluster
 *    with a real (Redis-backed) lock configured.
 * 2. **Stripe-level idempotency key**: `PaymentGateway.authorize` is
 *    always called with a deterministic key derived from `quote.id` (never
 *    from a per-attempt random value) — see
 *    `PaymentAuthorizationRequest.idempotencyKey`'s own doc comment. Even
 *    if the lock above is unavailable or its TTL is raced past, Stripe
 *    itself guarantees two calls with the same key and the same request
 *    parameters resolve to the *same* PaymentIntent, not two.
 * 3. **Database uniqueness**: `PaymentRepository.create` is required to be
 *    an upsert keyed on the *unique* `stripePaymentIntentId` column — even
 *    if both of the above somehow raced, two Payment rows for the same
 *    PaymentIntent can never both persist.
 *
 * Together, these three layers guarantee "double-click, browser refresh,
 * network retry, or two genuinely concurrent requests" can never result in
 * two separate Stripe charges or two Payment rows — the module brief's
 * explicit requirement.
 */
export class InitiateQuotePaymentUseCase {
  constructor(
    private readonly customerProfiles: CustomerProfileRepository,
    private readonly jobs: JobRepository,
    private readonly quotes: QuoteRepository,
    private readonly payments: PaymentRepository,
    private readonly paymentGateway: PaymentGateway,
    private readonly lock: DistributedLock,
    private readonly featureFlags: Pick<FeatureFlagService, "isEnabled">,
  ) {}

  async execute(userId: string, jobId: string): Promise<InitiateQuotePaymentResult> {
    const flagContext: FeatureFlagEvaluationContext = { userId };
    const enabled = await this.featureFlags.isEnabled(CUSTOMER_PAYMENT_CAPTURE_FLAG_KEY, flagContext);
    if (!enabled) {
      throw new ValidationError("Online payments are temporarily unavailable. Please try again later.");
    }

    const customer = await this.customerProfiles.findByUserId(userId);
    if (!customer) {
      throw new NotFoundError("Job", jobId);
    }

    const job = await this.jobs.findById(jobId);
    if (!job || job.customerId !== customer.id) {
      throw new NotFoundError("Job", jobId);
    }
    if (job.status === "CANCELLED") {
      throw new ValidationError("This job has been cancelled and can no longer be paid.");
    }

    const quote = await this.quotes.findById(job.quoteId);
    if (!quote || quote.serviceRequestId !== job.serviceRequestId) {
      throw new NotFoundError("Quote", job.quoteId);
    }
    if (quote.status !== "ACCEPTED") {
      throw new ValidationError("Only an accepted quote can be paid.");
    }

    const result = await this.lock.withLock(
      `payment:initiate:quote:${quote.id}`,
      PAYMENT_INITIATION_LOCK_TTL_MS,
      () => this.initiate(userId, job.serviceRequestId, quote.id, quote.items, quote.currency),
    );

    // `DistributedLock.withLock` returns `null` only when the lock is
    // already held by someone else — i.e. a concurrent request for this
    // exact Quote is already running this same sequence right now. Never
    // surfaced as an error: the caller (a Server Action) already has
    // Stripe/DB-level convergence as a backstop (see this class's own doc
    // comment), so the correct behavior here is "ask the customer to
    // retry in a moment," not a confusing failure — retrying a moment
    // later, after the concurrent attempt has finished, resolves to the
    // exact same PaymentIntent via this same use case's idempotency
    // layers.
    if (!result) {
      throw new ValidationError("A payment for this job is already being processed. Please try again in a moment.");
    }

    return result;
  }

  private async initiate(
    userId: string,
    serviceRequestId: string,
    quoteId: string,
    items: { quantity: number; unitPrice: number }[],
    currency: string,
  ): Promise<InitiateQuotePaymentResult> {
    const existing = await this.payments.findActiveByQuoteId(quoteId);
    if (existing && ALREADY_SETTLED_STATUSES.has(existing.status)) {
      throw new ValidationError("This job has already been paid.");
    }

    // Server-side authoritative recomputation — see this class's own doc
    // comment. `items` is server-loaded (never client input), so this is
    // pure defense-in-depth against `Quote.totalAmount` ever having drifted
    // from its own line items, not a trust boundary for anything supplied
    // by this request.
    const amount = calculateQuoteTotal(items);
    if (!(amount > 0)) {
      throw new ValidationError("This quote has no payable amount.");
    }

    const paymentId = randomUUID();
    const idempotencyKey = `payment-intent:quote:${quoteId}`;

    const authorization = await this.paymentGateway.authorize({
      paymentId,
      amount,
      currency,
      payerId: userId,
      metadata: { quoteId, serviceRequestId },
      idempotencyKey,
    });

    const record = await this.payments.create({
      id: paymentId,
      serviceRequestId,
      quoteId,
      payerId: userId,
      amount,
      currency,
      method: "CARD",
      stripePaymentIntentId: authorization.externalReference,
    });

    return {
      paymentId: record.id,
      clientSecret: authorization.clientSecret,
      amount: record.amount,
      currency: record.currency,
    };
  }
}

/** Statuses under which a *second* payment attempt for the same Quote must
 *  never be started — the quote has already been paid, in part or in
 *  full. `PENDING`/`AUTHORIZED` are deliberately excluded: an in-flight
 *  first attempt is safe to "retry" — see this class's own idempotency
 *  doc comment, layers 2-3 converge a retry onto the same
 *  PaymentIntent/row rather than creating a duplicate, so a customer who
 *  refreshes mid-payment is never blocked here. */
const ALREADY_SETTLED_STATUSES: ReadonlySet<PaymentStatusValue> = new Set(
  ACTIVE_PAYMENT_STATUSES.filter((status) => status !== "PENDING" && status !== "AUTHORIZED"),
);
