import type { CustomerProfileRecord, CustomerProfileRepository } from "@/domain/repositories/customer-profile-repository";
import type {
  CancelJobData,
  CompleteJobData,
  JobRecord,
  JobRepository,
  JobSummary,
  ListJobsOptions,
  StartJobData,
} from "@/domain/repositories/job-repository";
import type {
  CreateQuoteData,
  QuoteMaterialInput,
  QuoteRecord,
  QuoteRepository,
  QuoteStatusValue,
  UpdateQuoteFields,
} from "@/domain/repositories/quote-repository";
import {
  ACTIVE_PAYMENT_STATUSES,
  type CreatePaymentRecordData,
  type PaymentRecord,
  type PaymentRepository,
  type UpdatePaymentStatusInput,
  type UpdatePaymentStatusResult,
} from "@/domain/repositories/payment-repository";
import type {
  PaymentAuthorizationRequest,
  PaymentAuthorizationResult,
  PaymentGateway,
} from "@/application/ports/payment-gateway";
import type { DistributedLock } from "@/application/ports/distributed-lock";
import type {
  ClaimExternalWebhookEventInput,
  ClaimExternalWebhookEventResult,
  ExternalWebhookEventRecord,
  ExternalWebhookEventRepository,
} from "@/domain/repositories/external-webhook-event-repository";
import type { DomainEvent, DomainEventClass } from "@/domain/events/domain-event";
import type { EventBus, EventHandler } from "@/application/ports/event-bus";

/**
 * Module 73 — Real Customer Payment Capture: in-memory fakes for this
 * module's own use-case tests — same "one fakes.ts per module's own test
 * directory" convention `stripe-connect/fakes.ts` (Module 71/72) and
 * `onboarding/fakes.ts` already establish.
 */

export class FakeCustomerProfileRepository implements CustomerProfileRepository {
  byUserId = new Map<string, CustomerProfileRecord>();
  byId = new Map<string, CustomerProfileRecord>();

  seed(record: CustomerProfileRecord): void {
    this.byUserId.set(record.userId, record);
    this.byId.set(record.id, record);
  }

  async findByUserId(userId: string): Promise<CustomerProfileRecord | null> {
    return this.byUserId.get(userId) ?? null;
  }

  async findById(id: string): Promise<CustomerProfileRecord | null> {
    return this.byId.get(id) ?? null;
  }

  async findOrCreateByUserId(userId: string): Promise<CustomerProfileRecord> {
    const existing = this.byUserId.get(userId);
    if (existing) return existing;
    const created: CustomerProfileRecord = { id: `customer-${userId}`, userId };
    this.seed(created);
    return created;
  }
}

export class FakeJobRepository implements JobRepository {
  byId = new Map<string, JobRecord>();

  seed(record: JobRecord): void {
    this.byId.set(record.id, record);
  }

  async findById(id: string): Promise<JobRecord | null> {
    return this.byId.get(id) ?? null;
  }

  listForCustomer(_customerId: string, _options: ListJobsOptions): Promise<JobSummary[]> {
    throw new Error("not implemented in this fake");
  }
  listForProfessional(_professionalProfileId: string, _options: ListJobsOptions): Promise<JobSummary[]> {
    throw new Error("not implemented in this fake");
  }
  startWork(_data: StartJobData): Promise<JobRecord> {
    throw new Error("not implemented in this fake");
  }
  complete(_data: CompleteJobData): Promise<JobRecord> {
    throw new Error("not implemented in this fake");
  }
  cancel(_data: CancelJobData): Promise<JobRecord> {
    throw new Error("not implemented in this fake");
  }
}

export class FakeQuoteRepository implements QuoteRepository {
  byId = new Map<string, QuoteRecord>();

  seed(record: QuoteRecord): void {
    this.byId.set(record.id, record);
  }

  async findById(id: string): Promise<QuoteRecord | null> {
    return this.byId.get(id) ?? null;
  }

  findManyByProfessionalId(_professionalProfileId: string, _status?: QuoteStatusValue): Promise<QuoteRecord[]> {
    throw new Error("not implemented in this fake");
  }
  findManyByServiceRequestId(_serviceRequestId: string): Promise<QuoteRecord[]> {
    throw new Error("not implemented in this fake");
  }
  findActiveByServiceRequestAndProfessional(): Promise<QuoteRecord | null> {
    throw new Error("not implemented in this fake");
  }
  findByServiceRequestAndProfessional(): Promise<QuoteRecord | null> {
    throw new Error("not implemented in this fake");
  }
  create(_data: CreateQuoteData): Promise<QuoteRecord> {
    throw new Error("not implemented in this fake");
  }
  update(_id: string, _data: UpdateQuoteFields): Promise<QuoteRecord> {
    throw new Error("not implemented in this fake");
  }
  updateStatus(_id: string, _status: QuoteStatusValue): Promise<void> {
    throw new Error("not implemented in this fake");
  }
  findExpirable(): Promise<QuoteRecord[]> {
    throw new Error("not implemented in this fake");
  }
  confirmMaterialsPurchased(_quoteId: string, _confirmedByUserId: string): Promise<QuoteRecord> {
    throw new Error("not implemented in this fake");
  }
}

export function fakeQuoteRecord(overrides: Partial<QuoteRecord> = {}): QuoteRecord {
  return {
    id: "quote-1",
    serviceRequestId: "request-1",
    professionalProfileId: "pro-1",
    submittedByUserId: "pro-user-1",
    status: "ACCEPTED",
    totalAmount: 100,
    currency: "EUR",
    validUntil: null,
    notes: null,
    items: [{ id: "item-1", description: "Labor", quantity: 1, unitPrice: 100, amount: 100, sortOrder: 0, category: "LABOR" }],
    materialsStrategy: "PROFESSIONAL_SUPPLIED",
    materials: [] as QuoteMaterialInput[] as QuoteRecord["materials"],
    materialsConfirmedAt: null,
    materialsConfirmedByUserId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

export function fakeJobRecord(overrides: Partial<JobRecord> = {}): JobRecord {
  return {
    id: "job-1",
    serviceRequestId: "request-1",
    quoteId: "quote-1",
    customerId: "customer-1",
    professionalProfileId: "pro-1",
    companyProfileId: null,
    status: "CREATED",
    startedAt: null,
    startedByUserId: null,
    completedAt: null,
    completedByUserId: null,
    cancelledAt: null,
    cancelledByUserId: null,
    cancellationReason: null,
    cancellationNote: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

/** In-memory `PaymentRepository` implementing the exact same
 *  create-is-an-upsert / compare-and-swap `updateStatus` semantics as
 *  `PrismaPaymentRepository` — see that class's own doc comments for the
 *  contract this fake must faithfully reproduce for the concurrency tests
 *  in this module to mean anything. */
export class FakePaymentRepository implements PaymentRepository {
  byId = new Map<string, PaymentRecord>();
  byStripePaymentIntentId = new Map<string, string>();

  seed(record: PaymentRecord): void {
    this.byId.set(record.id, record);
    if (record.stripePaymentIntentId) this.byStripePaymentIntentId.set(record.stripePaymentIntentId, record.id);
  }

  async findById(id: string): Promise<PaymentRecord | null> {
    return this.byId.get(id) ?? null;
  }

  async findByJobId(): Promise<PaymentRecord[]> {
    throw new Error("not implemented in this fake");
  }

  async listForPayer(): Promise<PaymentRecord[]> {
    throw new Error("not implemented in this fake");
  }

  async sumProcessedRefunds(): Promise<number> {
    return 0;
  }

  async findByStripePaymentIntentId(stripePaymentIntentId: string): Promise<PaymentRecord | null> {
    const id = this.byStripePaymentIntentId.get(stripePaymentIntentId);
    return id ? (this.byId.get(id) ?? null) : null;
  }

  async findActiveByQuoteId(quoteId: string): Promise<PaymentRecord | null> {
    return (
      [...this.byId.values()].find(
        (p) => p.quoteId === quoteId && (ACTIVE_PAYMENT_STATUSES as readonly string[]).includes(p.status),
      ) ?? null
    );
  }

  async create(data: CreatePaymentRecordData): Promise<PaymentRecord> {
    const existing = await this.findByStripePaymentIntentId(data.stripePaymentIntentId);
    if (existing) return existing;

    const record: PaymentRecord = {
      id: data.id,
      serviceRequestId: data.serviceRequestId,
      quoteId: data.quoteId,
      jobId: null,
      payerId: data.payerId,
      amount: data.amount,
      currency: data.currency,
      status: "PENDING",
      capturedAt: null,
      stripePaymentIntentId: data.stripePaymentIntentId,
      method: data.method,
      failureReason: null,
    };
    this.seed(record);
    return record;
  }

  async updateStatus(input: UpdatePaymentStatusInput): Promise<UpdatePaymentStatusResult> {
    const record = this.byId.get(input.id);
    if (!record) throw new Error(`FakePaymentRepository.updateStatus: no payment ${input.id}`);
    if (!input.fromStatuses.includes(record.status)) {
      return { applied: false, record };
    }
    const updated: PaymentRecord = {
      ...record,
      status: input.toStatus,
      capturedAt: input.capturedAt !== undefined ? input.capturedAt : record.capturedAt,
      failureReason: input.failureReason !== undefined ? input.failureReason : record.failureReason,
    };
    this.byId.set(record.id, updated);
    return { applied: true, record: updated };
  }
}

/** Records every `authorize` call and returns a deterministic PaymentIntent
 *  id derived from the idempotency key — mirrors real Stripe idempotency
 *  behavior closely enough for the concurrency tests: two calls with the
 *  same `idempotencyKey` resolve to the same `externalReference`. */
export class FakePaymentGateway implements PaymentGateway {
  authorizeCalls: PaymentAuthorizationRequest[] = [];
  captureCalls: string[] = [];
  cancelCalls: string[] = [];
  refundCalls: { externalReference: string; amount: number }[] = [];
  nextError: Error | null = null;
  private byIdempotencyKey = new Map<string, string>();
  private counter = 0;

  async authorize(request: PaymentAuthorizationRequest): Promise<PaymentAuthorizationResult> {
    if (this.nextError) throw this.nextError;
    this.authorizeCalls.push(request);

    const key = request.idempotencyKey;
    if (key && this.byIdempotencyKey.has(key)) {
      const externalReference = this.byIdempotencyKey.get(key)!;
      return { externalReference, clientSecret: `${externalReference}_secret` };
    }

    this.counter += 1;
    const externalReference = `pi_fake_${this.counter}`;
    if (key) this.byIdempotencyKey.set(key, externalReference);
    return { externalReference, clientSecret: `${externalReference}_secret` };
  }

  async capture(externalReference: string): Promise<void> {
    if (this.nextError) throw this.nextError;
    this.captureCalls.push(externalReference);
  }

  async cancel(externalReference: string): Promise<void> {
    if (this.nextError) throw this.nextError;
    this.cancelCalls.push(externalReference);
  }

  async refund(externalReference: string, amount: number): Promise<void> {
    if (this.nextError) throw this.nextError;
    this.refundCalls.push({ externalReference, amount });
  }
}

/** In-process, single-key-at-a-time lock — sufficient to exercise
 *  `InitiateQuotePaymentUseCase`'s own lock usage without needing Redis;
 *  matches `InMemoryLockService`'s real observable behavior (a second
 *  concurrent `withLock` call for a held key returns `null` immediately). */
export class FakeDistributedLock implements DistributedLock {
  private held = new Set<string>();

  async withLock<T>(key: string, _ttlMs: number, fn: () => Promise<T>): Promise<T | null> {
    if (this.held.has(key)) return null;
    this.held.add(key);
    try {
      return await fn();
    } finally {
      this.held.delete(key);
    }
  }
}

export function fakeFeatureFlags(enabled = true): { isEnabled: () => Promise<boolean> } {
  return { isEnabled: async () => enabled };
}

/** Same claim/retry state machine as `stripe-connect/fakes.ts`'s own
 *  `FakeExternalWebhookEventRepository` — duplicated per this codebase's
 *  "one fakes.ts per module's own test directory" convention (see that
 *  file's own doc comment). */
export class FakeExternalWebhookEventRepository implements ExternalWebhookEventRepository {
  events = new Map<string, ExternalWebhookEventRecord>();
  private idCounter = 0;

  private findExisting(provider: string, externalEventId: string): ExternalWebhookEventRecord | undefined {
    return [...this.events.values()].find((e) => e.provider === provider && e.externalEventId === externalEventId);
  }

  async claim(input: ClaimExternalWebhookEventInput): Promise<ClaimExternalWebhookEventResult> {
    const existing = this.findExisting(input.provider, input.externalEventId);
    if (!existing) {
      const record: ExternalWebhookEventRecord = {
        id: `event-${++this.idCounter}`,
        provider: input.provider,
        externalEventId: input.externalEventId,
        eventType: input.eventType ?? null,
        status: "PROCESSING",
        processedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      this.events.set(record.id, record);
      return { claimed: true, record };
    }

    if (existing.status === "FAILED") {
      const reclaimed: ExternalWebhookEventRecord = {
        ...existing,
        status: "PROCESSING",
        eventType: input.eventType ?? existing.eventType,
        updatedAt: new Date(),
      };
      this.events.set(existing.id, reclaimed);
      return { claimed: true, record: reclaimed };
    }

    return { claimed: false, record: existing };
  }

  async markProcessed(id: string): Promise<ExternalWebhookEventRecord> {
    const existing = this.events.get(id);
    if (!existing) throw new Error(`No fake external webhook event with id "${id}".`);
    const updated: ExternalWebhookEventRecord = { ...existing, status: "PROCESSED", processedAt: new Date(), updatedAt: new Date() };
    this.events.set(id, updated);
    return updated;
  }

  async markFailed(id: string): Promise<ExternalWebhookEventRecord> {
    const existing = this.events.get(id);
    if (!existing) throw new Error(`No fake external webhook event with id "${id}".`);
    const updated: ExternalWebhookEventRecord = { ...existing, status: "FAILED", updatedAt: new Date() };
    this.events.set(id, updated);
    return updated;
  }
}

/** Minimal real-ish `EventBus` — synchronous, in-memory, same observable
 *  contract as `SynchronousEventBus` (handlers run in subscription order,
 *  a throwing handler doesn't stop siblings) but without importing the
 *  infrastructure module directly, keeping this fakes file dependency-free
 *  of any other module's composition root. */
export class FakeEventBus implements EventBus {
  private handlers = new Map<string, EventHandler<DomainEvent>[]>();
  published: DomainEvent[] = [];

  async publish<T extends DomainEvent>(event: T): Promise<void> {
    this.published.push(event);
    const subscribed = this.handlers.get(event.eventName) ?? [];
    for (const handler of subscribed) {
      await handler.handle(event);
    }
  }

  async publishAll(events: DomainEvent[]): Promise<void> {
    for (const event of events) await this.publish(event);
  }

  subscribe<T extends DomainEvent>(eventType: DomainEventClass<T>, handler: EventHandler<T>): void {
    const existing = this.handlers.get(eventType.eventName) ?? [];
    existing.push(handler as EventHandler<DomainEvent>);
    this.handlers.set(eventType.eventName, existing);
  }
}
