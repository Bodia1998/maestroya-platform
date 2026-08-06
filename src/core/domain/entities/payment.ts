import { randomUUID } from "node:crypto";

import { Entity } from "@/domain/entities/entity";
import type { DomainEvent } from "@/domain/events/domain-event";
import { PaymentCaptured } from "@/domain/events/payment-captured";
import { InvalidPaymentTransitionError, ValidationError } from "@/domain/errors/domain-error";
import {
  canTransitionPaymentStatus,
  isTerminalPaymentStatus,
  type PaymentStatus,
} from "@/domain/value-objects/payment-status";

/**
 * Module 35 — Payment Domain Model Preparation.
 *
 * The Payment aggregate: an infrastructure-independent model of a single
 * customer payment's lifecycle (create -> authorize? -> capture -> refund?)
 * that the application layer can depend on today, well before Module 59
 * wires it to Stripe Connect. Nothing here imports Stripe, Prisma, or any
 * other framework — see the module brief's "PaymentGateway is the only
 * abstraction the application depends on" rule
 * (`application/ports/payment-gateway.ts`); this class is the other half
 * of that rule, the thing `PaymentGateway` calls are made *on behalf of*.
 *
 * Distinct from `PaymentRecord`/`PaymentRepository`
 * (`domain/repositories/payment-repository.ts`, Module 22): that is a
 * read-only DTO/query interface over the already-existing `Payment` Prisma
 * table, deliberately without create/capture/refund methods (see its own
 * doc comment — "creating and capturing a Payment is Module 12
 * (Payment/Stripe Connect)'s job"). This class *is* that job's domain
 * model — the write side `PaymentRepository` was always expected to grow.
 * The two share the same status vocabulary (`PaymentStatus`) by design so
 * a future write-side repository can hydrate this aggregate from that same
 * `payments` table via `Payment.reconstitute()` without any schema change.
 *
 * ## State machine
 * See `domain/value-objects/payment-status.ts` for the full transition
 * graph. Summary: `PENDING` -> (`AUTHORIZED` ->)? `CAPTURED` ->
 * `PARTIALLY_REFUNDED`* -> `REFUNDED`, with `FAILED`/`CANCELLED` reachable
 * from `PENDING`/`AUTHORIZED`. Every transition method below rejects
 * moves the graph doesn't allow by throwing `InvalidPaymentTransitionError`
 * — callers never need to re-check the current status before calling one.
 */
export interface PaymentProps {
  serviceRequestId: string;
  payerId: string;
  amount: number;
  currency: string;
  status: PaymentStatus;
  /** Cumulative amount refunded so far. Tracked on the aggregate itself
   *  (not derived from a separate Refund collection) so `refund()` can
   *  enforce "never refund more than was paid" as an in-memory invariant,
   *  independent of how/whether refunds end up persisted as their own
   *  rows (the existing `Refund` Prisma model, once a write-side
   *  repository exists). */
  refundedAmount: number;
  failureReason: string | null;
  capturedAt: Date | null;
}

export interface CreatePaymentInput {
  id?: string;
  serviceRequestId: string;
  payerId: string;
  amount: number;
  /** ISO 4217 currency code. Defaults to "EUR" — the same default the
   *  `payments` Prisma column already uses. */
  currency?: string;
}

export class Payment extends Entity<PaymentProps> {
  private domainEvents: DomainEvent[] = [];

  private constructor(props: PaymentProps, id: string) {
    super(props, id);
  }

  /**
   * Creates a brand-new payment in `PENDING` status. This is the only
   * factory that validates input — `reconstitute()` assumes
   * already-persisted state is already valid.
   */
  static create(input: CreatePaymentInput): Payment {
    if (!input.serviceRequestId.trim()) {
      throw new ValidationError("A payment must reference a service request.");
    }
    if (!input.payerId.trim()) {
      throw new ValidationError("A payment must reference a payer.");
    }
    if (!Number.isFinite(input.amount) || input.amount <= 0) {
      throw new ValidationError("Payment amount must be a positive number.");
    }

    const currency = input.currency ?? "EUR";
    if (!/^[A-Z]{3}$/.test(currency)) {
      throw new ValidationError("Currency must be a 3-letter ISO 4217 code (e.g. \"EUR\").");
    }

    return new Payment(
      {
        serviceRequestId: input.serviceRequestId,
        payerId: input.payerId,
        amount: input.amount,
        currency,
        status: "PENDING",
        refundedAmount: 0,
        failureReason: null,
        capturedAt: null,
      },
      input.id ?? randomUUID(),
    );
  }

  /**
   * Rehydrates a `Payment` from already-persisted state (a future
   * write-side `PaymentRepository`'s job, Module 59) without re-running
   * `create()`'s input validation — a row already in the database is
   * assumed valid. Callers must not use this to bypass `create()`'s
   * invariants for a genuinely new payment.
   */
  static reconstitute(props: PaymentProps, id: string): Payment {
    return new Payment({ ...props }, id);
  }

  get status(): PaymentStatus {
    return this.props.status;
  }

  get serviceRequestId(): string {
    return this.props.serviceRequestId;
  }

  get payerId(): string {
    return this.props.payerId;
  }

  get amount(): number {
    return this.props.amount;
  }

  get currency(): string {
    return this.props.currency;
  }

  get refundedAmount(): number {
    return this.props.refundedAmount;
  }

  get failureReason(): string | null {
    return this.props.failureReason;
  }

  get capturedAt(): Date | null {
    return this.props.capturedAt;
  }

  /** The amount still available to refund — `amount - refundedAmount`. */
  get remainingRefundableAmount(): number {
    return this.props.amount - this.props.refundedAmount;
  }

  get isTerminal(): boolean {
    return isTerminalPaymentStatus(this.props.status);
  }

  /**
   * Reserves funds with the gateway without capturing them yet
   * (`PENDING` -> `AUTHORIZED`). Optional in the lifecycle — a
   * direct-capture flow can call `capture()` straight from `PENDING`.
   */
  authorize(): void {
    this.transitionTo("AUTHORIZED");
  }

  /**
   * Marks funds as actually taken (`PENDING`/`AUTHORIZED` -> `CAPTURED`)
   * and raises `PaymentCaptured` — see that event's own doc comment for
   * why capture is the one transition in this aggregate with a domain
   * event. Clears any previously recorded `failureReason` (a payment that
   * successfully captures is, by definition, no longer in a failed state).
   */
  capture(capturedAt: Date = new Date()): void {
    this.transitionTo("CAPTURED");
    this.props.capturedAt = capturedAt;
    this.props.failureReason = null;
    this.domainEvents.push(new PaymentCaptured(this.id, this.props.amount, this.props.currency));
  }

  /** Records a failed authorization/capture attempt (`PENDING`/
   *  `AUTHORIZED` -> `FAILED`). Terminal — a failed payment must be
   *  retried as a new `Payment`, never resurrected in place. */
  fail(reason: string): void {
    if (!reason.trim()) {
      throw new ValidationError("A failure reason is required to mark a payment as failed.");
    }
    this.transitionTo("FAILED");
    this.props.failureReason = reason;
  }

  /** Abandons a payment before capture (`PENDING`/`AUTHORIZED` ->
   *  `CANCELLED`). Terminal. */
  cancel(): void {
    this.transitionTo("CANCELLED");
  }

  /**
   * Refunds `amount` against a captured payment. Handled separately from
   * `transitionTo`'s fixed graph (see `payment-status.ts`'s doc comment)
   * because the resulting status depends on the *cumulative* refunded
   * amount, not just the current status: a partial refund can leave the
   * status unchanged (`PARTIALLY_REFUNDED` -> `PARTIALLY_REFUNDED`) while
   * still moving the aggregate's internal `refundedAmount` forward.
   */
  refund(amount: number): void {
    if (this.props.status !== "CAPTURED" && this.props.status !== "PARTIALLY_REFUNDED") {
      throw new InvalidPaymentTransitionError(
        `Cannot refund a payment in status ${this.props.status} — only CAPTURED or PARTIALLY_REFUNDED payments can be refunded.`,
      );
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new ValidationError("Refund amount must be a positive number.");
    }
    if (amount > this.remainingRefundableAmount) {
      throw new ValidationError(
        `Refund amount (${amount}) exceeds the remaining refundable amount (${this.remainingRefundableAmount}).`,
      );
    }

    this.props.refundedAmount += amount;
    this.props.status = this.props.refundedAmount === this.props.amount ? "REFUNDED" : "PARTIALLY_REFUNDED";
  }

  /**
   * Drains and returns domain events raised since the last call. Mirrors
   * the standard DDD "collect, then let the caller publish after persisting"
   * pattern: a use case (or, in Module 59, a webhook handler) is expected
   * to persist the aggregate first, then call
   * `eventBus.publishAll(payment.pullDomainEvents())` — never the other
   * way around, so a crash between capture and persistence can't result
   * in a commission being recorded for a payment that was never actually
   * saved as captured.
   */
  pullDomainEvents(): DomainEvent[] {
    const events = this.domainEvents;
    this.domainEvents = [];
    return events;
  }

  private transitionTo(next: PaymentStatus): void {
    if (!canTransitionPaymentStatus(this.props.status, next)) {
      throw new InvalidPaymentTransitionError(
        `Cannot transition payment from ${this.props.status} to ${next}.`,
      );
    }
    this.props.status = next;
  }
}
