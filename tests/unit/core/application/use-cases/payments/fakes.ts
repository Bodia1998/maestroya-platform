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

  async findByJobId(jobId: string): Promise<PaymentRecord[]> {
    return [...this.byId.values()].filter((p) => p.jobId === jobId);
  }

  async listForPayer(): Promise<PaymentRecord[]> {
    throw new Error("not implemented in this fake");
  }

  async sumProcessedRefunds(_paymentId: string): Promise<number> {
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
  private refundsByIdempotencyKey = new Map<string, string>();
  private refundCounter = 0;

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

  async refund(
    externalReference: string,
    amount: number,
    options?: { idempotencyKey?: string },
  ): Promise<{ externalRefundReference: string; status: "SUCCEEDED" | "PENDING" | "FAILED" }> {
    if (this.nextError) throw this.nextError;
    this.refundCalls.push({ externalReference, amount });

    const key = options?.idempotencyKey;
    if (key && this.refundsByIdempotencyKey.has(key)) {
      return { externalRefundReference: this.refundsByIdempotencyKey.get(key)!, status: "SUCCEEDED" };
    }
    this.refundCounter += 1;
    const externalRefundReference = `re_fake_${this.refundCounter}`;
    if (key) this.refundsByIdempotencyKey.set(key, externalRefundReference);
    return { externalRefundReference, status: "SUCCEEDED" };
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
// ===========================================================================
// Module 76 — Professional Payout Execution: additional in-memory fakes.
// ===========================================================================

import type {
  ConfirmCompletionData,
  CreateJobCompletionConfirmationData,
  DisputeCompletionData,
  JobCompletionConfirmationRecord,
  JobCompletionConfirmationRepository,
  TimeOutCompletionData,
  UpdateReleaseDecisionData,
} from "@/domain/repositories/job-completion-confirmation-repository";
import type { DisputeRecord, DisputeRepository } from "@/domain/repositories/dispute-repository";
import type { CommissionRecord, CommissionRepository, CreateCommissionData } from "@/domain/repositories/commission-repository";
import type { CompanyRecord, CompanyRepository, CreateCompanyData, UpdateCompanyData } from "@/domain/repositories/company-repository";
import type {
  CompanyVerificationRecord,
  CompanyVerificationRepository,
} from "@/domain/repositories/company-verification-repository";
import type {
  CompanyPayoutAccountRecord,
  CompanyPayoutAccountRepository,
  CreateCompanyPayoutAccountData,
  UpdateCompanyStripeConnectAccountData,
} from "@/domain/repositories/company-payout-account-repository";
import type {
  TrustAutomatedActionRecord,
  TrustAutomatedActionRepository,
  TrustAutomatedActionTypeValue,
} from "@/domain/repositories/trust-automated-action-repository";
import type {
  CreatePendingPayoutData,
  MarkPayoutFailedInput,
  MarkPayoutPaidInput,
  MarkPayoutReversalFailedInput,
  MarkPayoutReversedInput,
  PayoutRecord,
  PayoutRepository,
  UpdatePayoutResult,
} from "@/domain/repositories/payout-repository";
import type {
  CreateTransferRequest,
  CreateTransferResult,
  ReverseTransferRequest,
  ReverseTransferResult,
  StripeTransferGateway,
} from "@/application/ports/stripe-transfer-gateway";

let payoutFakeIdCounter = 0;
function payoutFakeNextId(prefix: string): string {
  payoutFakeIdCounter += 1;
  return `${prefix}-${payoutFakeIdCounter}`;
}

/** Only `findByJobId`/`updateReleaseDecision` are meaningfully implemented
 *  — the only two methods `ExecuteProfessionalPayoutUseCase`'s own
 *  dependency graph reaches. */
export class FakeJobCompletionConfirmationRepository implements JobCompletionConfirmationRepository {
  byJobId = new Map<string, JobCompletionConfirmationRecord>();

  seed(overrides: Partial<JobCompletionConfirmationRecord> & { jobId: string }): JobCompletionConfirmationRecord {
    const record: JobCompletionConfirmationRecord = {
      id: overrides.id ?? payoutFakeNextId("confirmation"),
      jobId: overrides.jobId,
      status: overrides.status ?? "CONFIRMED",
      professionalCompletedAt: overrides.professionalCompletedAt ?? new Date(),
      confirmationDeadlineAt: overrides.confirmationDeadlineAt ?? new Date(),
      confirmedAt: overrides.confirmedAt ?? new Date(),
      confirmedByUserId: overrides.confirmedByUserId ?? "customer-user-1",
      disputeId: overrides.disputeId ?? null,
      manualReviewCaseId: overrides.manualReviewCaseId ?? null,
      reminderSentAt: overrides.reminderSentAt ?? null,
      releaseStatus: overrides.releaseStatus ?? "RELEASE_APPROVED",
      releaseReason: overrides.releaseReason ?? "Approved.",
      releaseDecidedAt: overrides.releaseDecidedAt ?? new Date(),
      createdAt: overrides.createdAt ?? new Date(),
      updatedAt: overrides.updatedAt ?? new Date(),
    };
    this.byJobId.set(record.jobId, record);
    return record;
  }

  async findById(id: string): Promise<JobCompletionConfirmationRecord | null> {
    return [...this.byJobId.values()].find((r) => r.id === id) ?? null;
  }
  async findByJobId(jobId: string): Promise<JobCompletionConfirmationRecord | null> {
    return this.byJobId.get(jobId) ?? null;
  }
  create(_data: CreateJobCompletionConfirmationData): Promise<JobCompletionConfirmationRecord> {
    throw new Error("not implemented in this fake");
  }
  confirm(_data: ConfirmCompletionData): Promise<JobCompletionConfirmationRecord> {
    throw new Error("not implemented in this fake");
  }
  markDisputed(_data: DisputeCompletionData): Promise<JobCompletionConfirmationRecord> {
    throw new Error("not implemented in this fake");
  }
  markTimedOut(_data: TimeOutCompletionData): Promise<JobCompletionConfirmationRecord> {
    throw new Error("not implemented in this fake");
  }
  markReminderSent(): Promise<JobCompletionConfirmationRecord> {
    throw new Error("not implemented in this fake");
  }
  async updateReleaseDecision(data: UpdateReleaseDecisionData): Promise<JobCompletionConfirmationRecord> {
    const existing = [...this.byJobId.values()].find((r) => r.id === data.id);
    if (!existing) throw new Error("not found");
    const updated: JobCompletionConfirmationRecord = {
      ...existing,
      releaseStatus: data.releaseStatus,
      releaseReason: data.releaseReason,
      releaseDecidedAt: data.releaseDecidedAt,
    };
    this.byJobId.set(updated.jobId, updated);
    return updated;
  }
  findOverdue(): Promise<JobCompletionConfirmationRecord[]> {
    throw new Error("not implemented in this fake");
  }
  findDueForReminder(): Promise<JobCompletionConfirmationRecord[]> {
    throw new Error("not implemented in this fake");
  }
}

export class FakeDisputeRepository implements DisputeRepository {
  byJobId = new Map<string, DisputeRecord[]>();

  seedOpenDispute(jobId: string, overrides: Partial<DisputeRecord> = {}): DisputeRecord {
    const record = this.buildDispute(jobId, { status: "OPEN", ...overrides });
    const existing = this.byJobId.get(jobId) ?? [];
    this.byJobId.set(jobId, [...existing, record]);
    return record;
  }

  private buildDispute(jobId: string, overrides: Partial<DisputeRecord>): DisputeRecord {
    return {
      id: overrides.id ?? payoutFakeNextId("dispute"),
      caseNumber: overrides.caseNumber ?? "DSP-0001",
      title: overrides.title ?? "Dispute",
      jobId,
      serviceRequestId: overrides.serviceRequestId ?? "request-1",
      raisedByUserId: overrides.raisedByUserId ?? "customer-user-1",
      respondentProfessionalProfileId: overrides.respondentProfessionalProfileId ?? null,
      respondentCompanyProfileId: overrides.respondentCompanyProfileId ?? null,
      reason: overrides.reason ?? "OTHER",
      status: overrides.status ?? "OPEN",
      priority: overrides.priority ?? "MEDIUM",
      description: overrides.description ?? "Dispute description.",
      assignedAdminUserId: overrides.assignedAdminUserId ?? null,
      resolution: overrides.resolution ?? null,
      resolutionNote: overrides.resolutionNote ?? null,
      resolvedAt: overrides.resolvedAt ?? null,
      resolvedByUserId: overrides.resolvedByUserId ?? null,
      closedAt: overrides.closedAt ?? null,
      closedByUserId: overrides.closedByUserId ?? null,
      createdAt: overrides.createdAt ?? new Date(),
    } as DisputeRecord;
  }

  async findById(id: string): Promise<DisputeRecord | null> {
    return [...this.byJobId.values()].flat().find((d) => d.id === id) ?? null;
  }
  async listByJobId(jobId: string): Promise<DisputeRecord[]> {
    return this.byJobId.get(jobId) ?? [];
  }
  listRaisedByUser(): Promise<DisputeRecord[]> {
    throw new Error("not implemented in this fake");
  }
  listForAdmin(): Promise<DisputeRecord[]> {
    throw new Error("not implemented in this fake");
  }
  create(): Promise<DisputeRecord> {
    throw new Error("not implemented in this fake");
  }
  assign(): Promise<DisputeRecord> {
    throw new Error("not implemented in this fake");
  }
  setPriority(): Promise<DisputeRecord> {
    throw new Error("not implemented in this fake");
  }
  updateStatus(): Promise<DisputeRecord> {
    throw new Error("not implemented in this fake");
  }
}

export class FakeCommissionRepository implements CommissionRepository {
  byPaymentId = new Map<string, CommissionRecord>();

  async findByPaymentId(paymentId: string): Promise<CommissionRecord | null> {
    return this.byPaymentId.get(paymentId) ?? null;
  }
  async create(data: CreateCommissionData): Promise<CommissionRecord> {
    const existing = this.byPaymentId.get(data.paymentId);
    if (existing) return existing;
    const record: CommissionRecord = {
      id: payoutFakeNextId("commission"),
      paymentId: data.paymentId,
      professionalProfileId: data.professionalProfileId,
      companyProfileId: data.companyProfileId,
      rateBps: data.rateBps,
      amount: data.amount,
      status: "PENDING",
      settledAt: null,
      createdAt: new Date(),
    };
    this.byPaymentId.set(data.paymentId, record);
    return record;
  }
  listForProfessional(): Promise<CommissionRecord[]> {
    throw new Error("not implemented in this fake");
  }
  listForCompany(): Promise<CommissionRecord[]> {
    throw new Error("not implemented in this fake");
  }
}

export class FakeCompanyRepository implements CompanyRepository {
  byId = new Map<string, CompanyRecord>();

  seed(overrides: Partial<CompanyRecord> & { ownerUserId: string }): CompanyRecord {
    const record: CompanyRecord = {
      id: overrides.id ?? payoutFakeNextId("company"),
      ownerUserId: overrides.ownerUserId,
      legalName: overrides.legalName ?? "Acme S.L.",
      tradeName: overrides.tradeName ?? null,
      taxId: overrides.taxId ?? "B12345678",
      description: overrides.description ?? null,
      logoUrl: overrides.logoUrl ?? null,
      websiteUrl: overrides.websiteUrl ?? null,
      slug: overrides.slug ?? null,
      contactEmail: overrides.contactEmail ?? null,
      contactPhone: overrides.contactPhone ?? null,
      addressLine: overrides.addressLine ?? null,
      city: overrides.city ?? null,
      province: overrides.province ?? null,
      postalCode: overrides.postalCode ?? null,
      country: overrides.country ?? null,
      latitude: overrides.latitude ?? null,
      longitude: overrides.longitude ?? null,
      status: overrides.status ?? "ACTIVE",
      suspendedAt: overrides.suspendedAt ?? null,
      isVerified: overrides.isVerified ?? false,
      verifiedAt: overrides.verifiedAt ?? null,
      stripeConnectAccountId: overrides.stripeConnectAccountId ?? null,
      averageRating: overrides.averageRating ?? null,
      reviewCount: overrides.reviewCount ?? 0,
      isAcceptingRequests: overrides.isAcceptingRequests ?? true,
      categoryIds: overrides.categoryIds ?? [],
      createdAt: overrides.createdAt ?? new Date(),
      updatedAt: overrides.updatedAt ?? new Date(),
    };
    this.byId.set(record.id, record);
    return record;
  }

  async findById(id: string): Promise<CompanyRecord | null> {
    return this.byId.get(id) ?? null;
  }
  async findByOwnerUserId(ownerUserId: string): Promise<CompanyRecord | null> {
    return [...this.byId.values()].find((c) => c.ownerUserId === ownerUserId) ?? null;
  }
  findBySlug(): Promise<CompanyRecord | null> {
    throw new Error("not implemented in this fake");
  }
  findByTaxId(): Promise<CompanyRecord | null> {
    throw new Error("not implemented in this fake");
  }
  existsBySlug(): Promise<boolean> {
    throw new Error("not implemented in this fake");
  }
  create(_ownerUserId: string, _data: CreateCompanyData): Promise<CompanyRecord> {
    throw new Error("not implemented in this fake");
  }
  update(_id: string, _data: UpdateCompanyData): Promise<CompanyRecord> {
    throw new Error("not implemented in this fake");
  }
  updateStatus(): Promise<void> {
    throw new Error("not implemented in this fake");
  }
  updateCategories(): Promise<CompanyRecord> {
    throw new Error("not implemented in this fake");
  }
  updateOwner(): Promise<void> {
    throw new Error("not implemented in this fake");
  }
}

export class FakeCompanyVerificationRepository implements CompanyVerificationRepository {
  active = new Map<string, CompanyVerificationRecord>();

  seedApproved(companyProfileId: string): void {
    this.active.set(companyProfileId, {
      id: payoutFakeNextId("company-verification"),
      companyProfileId,
      status: "APPROVED",
      submittedAt: new Date(),
      reviewedAt: new Date(),
      reviewedByUserId: "admin-1",
      rejectionReason: null,
      resubmissionReason: null,
      expiresAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  async findActiveByCompanyProfileId(companyProfileId: string): Promise<CompanyVerificationRecord | null> {
    return this.active.get(companyProfileId) ?? null;
  }
  findActiveWithDocumentsByCompanyProfileId(): Promise<never> {
    throw new Error("not implemented in this fake");
  }
  create(): Promise<CompanyVerificationRecord> {
    throw new Error("not implemented in this fake");
  }
  findById(): Promise<CompanyVerificationRecord | null> {
    throw new Error("not implemented in this fake");
  }
  updateStatus(): Promise<CompanyVerificationRecord> {
    throw new Error("not implemented in this fake");
  }
  addDocument(): Promise<never> {
    throw new Error("not implemented in this fake");
  }
  findDocumentById(): Promise<never> {
    throw new Error("not implemented in this fake");
  }
  listDocuments(): Promise<never> {
    throw new Error("not implemented in this fake");
  }
  countDocuments(): Promise<number> {
    throw new Error("not implemented in this fake");
  }
  removeDocument(): Promise<void> {
    throw new Error("not implemented in this fake");
  }
  setCompanyVerifiedStatus(): Promise<void> {
    throw new Error("not implemented in this fake");
  }
  listForAdmin(): Promise<never> {
    throw new Error("not implemented in this fake");
  }
  getDetailForAdmin(): Promise<never> {
    throw new Error("not implemented in this fake");
  }
  findExpirable(): Promise<CompanyVerificationRecord[]> {
    throw new Error("not implemented in this fake");
  }
}

export class FakeCompanyPayoutAccountRepository implements CompanyPayoutAccountRepository {
  byCompanyProfileId = new Map<string, CompanyPayoutAccountRecord>();

  seedStripeReady(companyProfileId: string, stripeExpressAccountId = "acct_company_1"): CompanyPayoutAccountRecord {
    const record: CompanyPayoutAccountRecord = {
      id: payoutFakeNextId("company-payout-account"),
      companyProfileId,
      method: "STRIPE_EXPRESS",
      status: "VERIFIED",
      accountHolderName: "Acme S.L.",
      ibanLast4: null,
      ibanHash: null,
      stripeExpressAccountId,
      stripeExpressStatus: "READY",
      stripeChargesEnabled: true,
      stripePayoutsEnabled: true,
      stripeDetailsSubmitted: true,
      stripeRequirementsCurrentlyDue: false,
      stripeConnectSyncedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.byCompanyProfileId.set(companyProfileId, record);
    return record;
  }

  async findByCompanyProfileId(companyProfileId: string): Promise<CompanyPayoutAccountRecord | null> {
    return this.byCompanyProfileId.get(companyProfileId) ?? null;
  }
  async findByStripeAccountId(stripeAccountId: string): Promise<CompanyPayoutAccountRecord | null> {
    return [...this.byCompanyProfileId.values()].find((a) => a.stripeExpressAccountId === stripeAccountId) ?? null;
  }
  upsertPayoutAccount(_data: CreateCompanyPayoutAccountData): Promise<CompanyPayoutAccountRecord> {
    throw new Error("not implemented in this fake");
  }
  updateStripeConnectAccount(_companyProfileId: string, _data: UpdateCompanyStripeConnectAccountData): Promise<CompanyPayoutAccountRecord> {
    throw new Error("not implemented in this fake");
  }
}

export class FakeTrustAutomatedActionRepository implements TrustAutomatedActionRepository {
  activeByUser = new Map<string, TrustAutomatedActionRecord[]>();

  seedActivePayoutHold(userId: string): TrustAutomatedActionRecord {
    const record: TrustAutomatedActionRecord = {
      id: payoutFakeNextId("trust-action"),
      userId,
      type: "PAYOUT_HOLD",
      status: "ACTIVE",
      reason: "ADMIN_ADJUSTMENT",
      triggeringRiskScore: 0,
      detail: "Held for review.",
      createdByUserId: "admin-1",
      expiresAt: null,
      reversedAt: null,
      reversedByUserId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const existing = this.activeByUser.get(userId) ?? [];
    this.activeByUser.set(userId, [...existing, record]);
    return record;
  }

  create(): Promise<TrustAutomatedActionRecord> {
    throw new Error("not implemented in this fake");
  }
  findById(): Promise<TrustAutomatedActionRecord | null> {
    throw new Error("not implemented in this fake");
  }
  listForUser(): Promise<TrustAutomatedActionRecord[]> {
    throw new Error("not implemented in this fake");
  }
  async listActiveForUser(userId: string, type?: TrustAutomatedActionTypeValue): Promise<TrustAutomatedActionRecord[]> {
    const all = this.activeByUser.get(userId) ?? [];
    return type ? all.filter((a) => a.type === type) : all;
  }
  countActiveForUser(): Promise<number> {
    throw new Error("not implemented in this fake");
  }
  reverse(): Promise<TrustAutomatedActionRecord> {
    throw new Error("not implemented in this fake");
  }
  expireDue(): Promise<number> {
    throw new Error("not implemented in this fake");
  }
  countAll(): Promise<number> {
    throw new Error("not implemented in this fake");
  }
  countByType(): Promise<number> {
    throw new Error("not implemented in this fake");
  }
  countActive(): Promise<number> {
    throw new Error("not implemented in this fake");
  }
}

/** Same compare-and-swap semantics as `PrismaPayoutRepository` — see that
 *  class's own doc comment. Duplicated here per this codebase's "one
 *  fakes.ts per module's own test directory" convention (mirrors
 *  `stripe-connect/fakes.ts`'s own `FakePayoutRepository`). */
export class FakePayoutRepository implements PayoutRepository {
  byId = new Map<string, PayoutRecord>();
  private idCounter = 0;

  async findById(id: string): Promise<PayoutRecord | null> {
    return this.byId.get(id) ?? null;
  }
  async findByJobId(jobId: string): Promise<PayoutRecord | null> {
    return [...this.byId.values()].find((p) => p.jobId === jobId) ?? null;
  }
  async createPending(data: CreatePendingPayoutData): Promise<PayoutRecord> {
    const existing = await this.findByJobId(data.jobId);
    if (existing) return existing;
    const now = new Date();
    const record: PayoutRecord = {
      id: `payout-${++this.idCounter}`,
      jobId: data.jobId,
      paymentId: data.paymentId,
      professionalProfileId: data.professionalProfileId,
      companyProfileId: data.companyProfileId,
      amount: data.amount,
      currency: data.currency,
      status: "PENDING",
      stripeTransferId: null,
      idempotencyKey: data.idempotencyKey,
      failureReason: null,
      attemptCount: 0,
      lastAttemptedAt: null,
      processedAt: null,
      stripeReversalId: null,
      reversalIdempotencyKey: null,
      reversedAmount: null,
      reversalFailureReason: null,
      reversalAttemptCount: 0,
      reversedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    this.byId.set(record.id, record);
    return record;
  }
  async markPaid(input: MarkPayoutPaidInput): Promise<UpdatePayoutResult> {
    const existing = this.byId.get(input.id);
    if (!existing) throw new Error(`No fake payout with id "${input.id}".`);
    if (!input.fromStatuses.includes(existing.status)) return { applied: false, record: existing };
    const updated: PayoutRecord = {
      ...existing,
      status: "PAID",
      stripeTransferId: input.stripeTransferId,
      processedAt: new Date(),
      lastAttemptedAt: new Date(),
      failureReason: null,
      updatedAt: new Date(),
    };
    this.byId.set(input.id, updated);
    return { applied: true, record: updated };
  }
  async markFailed(input: MarkPayoutFailedInput): Promise<UpdatePayoutResult> {
    const existing = this.byId.get(input.id);
    if (!existing) throw new Error(`No fake payout with id "${input.id}".`);
    if (!input.fromStatuses.includes(existing.status)) return { applied: false, record: existing };
    const updated: PayoutRecord = {
      ...existing,
      status: "FAILED",
      failureReason: input.failureReason,
      lastAttemptedAt: new Date(),
      attemptCount: existing.attemptCount + 1,
      updatedAt: new Date(),
    };
    this.byId.set(input.id, updated);
    return { applied: true, record: updated };
  }

  async markReversed(input: MarkPayoutReversedInput): Promise<UpdatePayoutResult> {
    const existing = this.byId.get(input.id);
    if (!existing) throw new Error(`No fake payout with id "${input.id}".`);
    if (!input.fromStatuses.includes(existing.status)) return { applied: false, record: existing };
    const updated: PayoutRecord = {
      ...existing,
      status: "REVERSED",
      stripeReversalId: input.stripeReversalId,
      reversedAmount: input.reversedAmount,
      reversalIdempotencyKey: input.reversalIdempotencyKey,
      reversalFailureReason: null,
      reversedAt: new Date(),
      updatedAt: new Date(),
    };
    this.byId.set(input.id, updated);
    return { applied: true, record: updated };
  }

  async markReversalFailed(input: MarkPayoutReversalFailedInput): Promise<UpdatePayoutResult> {
    const existing = this.byId.get(input.id);
    if (!existing) throw new Error(`No fake payout with id "${input.id}".`);
    if (!input.fromStatuses.includes(existing.status)) return { applied: false, record: existing };
    const updated: PayoutRecord = {
      ...existing,
      reversalFailureReason: input.reversalFailureReason,
      reversalAttemptCount: existing.reversalAttemptCount + 1,
      updatedAt: new Date(),
    };
    this.byId.set(input.id, updated);
    return { applied: true, record: updated };
  }
}

export class FakeStripeTransferGateway implements StripeTransferGateway {
  calls: CreateTransferRequest[] = [];
  reversalCalls: ReverseTransferRequest[] = [];
  nextError: Error | null = null;
  nextReversalError: Error | null = null;
  private byIdempotencyKey = new Map<string, string>();
  private counter = 0;
  private reversalsByIdempotencyKey = new Map<string, string>();
  private reversalCounter = 0;

  async createTransfer(request: CreateTransferRequest): Promise<CreateTransferResult> {
    this.calls.push(request);
    if (this.nextError) throw this.nextError;

    const existing = this.byIdempotencyKey.get(request.idempotencyKey);
    if (existing) return { stripeTransferId: existing };

    this.counter += 1;
    const stripeTransferId = `tr_fake_${this.counter}`;
    this.byIdempotencyKey.set(request.idempotencyKey, stripeTransferId);
    return { stripeTransferId };
  }

  async reverseTransfer(request: ReverseTransferRequest): Promise<ReverseTransferResult> {
    this.reversalCalls.push(request);
    if (this.nextReversalError) throw this.nextReversalError;

    const existing = this.reversalsByIdempotencyKey.get(request.idempotencyKey);
    if (existing) return { stripeReversalId: existing };

    this.reversalCounter += 1;
    const stripeReversalId = `trr_fake_${this.reversalCounter}`;
    this.reversalsByIdempotencyKey.set(request.idempotencyKey, stripeReversalId);
    return { stripeReversalId };
  }
}
