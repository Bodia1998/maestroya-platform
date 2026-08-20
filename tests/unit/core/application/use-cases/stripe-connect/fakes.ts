import type {
  AuthUserRecord,
  SignupIntentValue,
  UpdateProfileData,
  UserProfileRecord,
  UserRepository,
} from "@/domain/repositories/user-repository";
import type {
  CreateConnectedAccountRequest,
  CreateConnectedAccountResult,
  CreateLoginLinkResult,
  CreateOnboardingLinkOptions,
  CreateOnboardingLinkResult,
  StripeAccountStatusResult,
  StripeConnectGateway,
} from "@/application/ports/stripe-connect-gateway";
import type {
  ClaimExternalWebhookEventInput,
  ClaimExternalWebhookEventResult,
  ExternalWebhookEventRecord,
  ExternalWebhookEventRepository,
} from "@/domain/repositories/external-webhook-event-repository";
import type {
  CreatePendingPayoutData,
  MarkPayoutFailedInput,
  MarkPayoutPaidInput,
  MarkPayoutReversalFailedInput,
  MarkPayoutReversedInput,
  PayoutRecord,
  PayoutRepository,
  PayoutStatusValue,
  UpdatePayoutResult,
} from "@/domain/repositories/payout-repository";

/**
 * Module 71 — Stripe Connect: in-memory fakes for this module's own
 * use-case tests — same "one fakes.ts per module's test directory"
 * convention as `tests/unit/core/application/use-cases/onboarding/fakes.ts`.
 */

/**
 * Only `findById` is meaningfully implemented — this module's use cases
 * (`CreateStripeConnectedAccountUseCase`) call nothing else on
 * `UserRepository`. Every other method throws, the same "narrow fake,
 * loud failure if a use case starts depending on more" convention
 * `FakeProfessionalOnboardingRepository`'s sibling fakes use.
 */
export class FakeUserRepository implements UserRepository {
  byId = new Map<string, AuthUserRecord>();

  seed(record: AuthUserRecord): void {
    this.byId.set(record.id, record);
  }

  async findById(id: string): Promise<AuthUserRecord | null> {
    return this.byId.get(id) ?? null;
  }

  findByEmail(): Promise<AuthUserRecord | null> {
    throw new Error("not implemented in this fake");
  }
  createWithPassword(): Promise<AuthUserRecord> {
    throw new Error("not implemented in this fake");
  }
  updatePasswordHash(): Promise<void> {
    throw new Error("not implemented in this fake");
  }
  markEmailVerified(): Promise<void> {
    throw new Error("not implemented in this fake");
  }
  updateLastLoginAt(): Promise<void> {
    throw new Error("not implemented in this fake");
  }
  getRoleKeys(): Promise<string[]> {
    throw new Error("not implemented in this fake");
  }
  assignDefaultRole(): Promise<void> {
    throw new Error("not implemented in this fake");
  }
  getSignupIntent(): Promise<SignupIntentValue | null> {
    throw new Error("not implemented in this fake");
  }
  clearSignupIntent(): Promise<void> {
    throw new Error("not implemented in this fake");
  }
  findProfileById(): Promise<UserProfileRecord | null> {
    throw new Error("not implemented in this fake");
  }
  updateProfile(_userId: string, _data: UpdateProfileData): Promise<void> {
    throw new Error("not implemented in this fake");
  }
  updateAvatar(): Promise<void> {
    throw new Error("not implemented in this fake");
  }
  softDeleteAccount(): Promise<void> {
    throw new Error("not implemented in this fake");
  }
  getPreferredLocale(): Promise<string | null> {
    throw new Error("not implemented in this fake");
  }
  updatePreferredLocale(): Promise<void> {
    throw new Error("not implemented in this fake");
  }
}

export class FakeStripeConnectGateway implements StripeConnectGateway {
  createConnectedAccountCalls: CreateConnectedAccountRequest[] = [];
  createOnboardingLinkCalls: { stripeAccountId: string; options: CreateOnboardingLinkOptions }[] = [];
  createLoginLinkCalls: string[] = [];
  retrieveAccountStatusCalls: string[] = [];

  nextAccountId = "acct_fake";
  nextStatus: StripeAccountStatusResult | null = null;
  nextError: Error | null = null;

  async createConnectedAccount(request: CreateConnectedAccountRequest): Promise<CreateConnectedAccountResult> {
    if (this.nextError) throw this.nextError;
    this.createConnectedAccountCalls.push(request);
    return { stripeAccountId: this.nextAccountId };
  }

  async createOnboardingLink(
    stripeAccountId: string,
    options: CreateOnboardingLinkOptions,
  ): Promise<CreateOnboardingLinkResult> {
    if (this.nextError) throw this.nextError;
    this.createOnboardingLinkCalls.push({ stripeAccountId, options });
    return { url: `https://connect.stripe.com/setup/e/${stripeAccountId}`, expiresAt: new Date(Date.now() + 300_000) };
  }

  async retrieveAccountStatus(stripeAccountId: string): Promise<StripeAccountStatusResult> {
    if (this.nextError) throw this.nextError;
    this.retrieveAccountStatusCalls.push(stripeAccountId);
    return (
      this.nextStatus ?? {
        stripeAccountId,
        detailsSubmitted: false,
        transfersActive: false,
        payoutsEnabled: false,
        requirementsCurrentlyDue: [],
        disabledReason: null,
      }
    );
  }

  async createLoginLink(stripeAccountId: string): Promise<CreateLoginLinkResult> {
    if (this.nextError) throw this.nextError;
    this.createLoginLinkCalls.push(stripeAccountId);
    return { url: `https://connect.stripe.com/express/${stripeAccountId}` };
  }
}

/**
 * Module 72 — Stripe Webhooks: in-memory `ExternalWebhookEventRepository`
 * implementing the exact same claim/retry state machine as
 * `PrismaExternalWebhookEventRepository` — the same fake shape
 * `tests/integration/verification/persona-webhook-flows.test.ts` already
 * defines for Persona (see that file's own doc comment on why: claim-by-
 * insert, `(provider, externalEventId)` uniqueness, a `FAILED` event is
 * the only one a later delivery may reclaim), kept as its own copy here
 * per this codebase's "one fakes.ts per module's own test directory"
 * convention.
 */
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
    const updated: ExternalWebhookEventRecord = {
      ...existing,
      status: "PROCESSED",
      processedAt: new Date(),
      updatedAt: new Date(),
    };
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
/**
 * Module 76 — Professional Payout Execution: in-memory `PayoutRepository`
 * — the same compare-and-swap semantics
 * (`PrismaPayoutRepository`/`markPaid`/`markFailed`'s own "WHERE status IN
 * fromStatuses" guard) implemented over a plain `Map`, so tests exercising
 * concurrent/duplicate execution observe the exact same "only one caller's
 * write can ever apply" behavior the real Postgres-backed implementation
 * gives.
 */
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
    if (!input.fromStatuses.includes(existing.status)) {
      return { applied: false, record: existing };
    }
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
    if (!input.fromStatuses.includes(existing.status)) {
      return { applied: false, record: existing };
    }
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

  /** Test-only helper for seeding a specific status directly. */
  seed(overrides: Partial<PayoutRecord> & { jobId: string }): PayoutRecord {
    const now = new Date();
    const record: PayoutRecord = {
      id: overrides.id ?? `payout-${++this.idCounter}`,
      jobId: overrides.jobId,
      paymentId: overrides.paymentId ?? "payment-1",
      professionalProfileId: overrides.professionalProfileId ?? null,
      companyProfileId: overrides.companyProfileId ?? null,
      amount: overrides.amount ?? 100,
      currency: overrides.currency ?? "EUR",
      status: (overrides.status ?? "PENDING") as PayoutStatusValue,
      stripeTransferId: overrides.stripeTransferId ?? null,
      idempotencyKey: overrides.idempotencyKey ?? `payout:${overrides.jobId}`,
      failureReason: overrides.failureReason ?? null,
      attemptCount: overrides.attemptCount ?? 0,
      lastAttemptedAt: overrides.lastAttemptedAt ?? null,
      processedAt: overrides.processedAt ?? null,
      stripeReversalId: overrides.stripeReversalId ?? null,
      reversalIdempotencyKey: overrides.reversalIdempotencyKey ?? null,
      reversedAmount: overrides.reversedAmount ?? null,
      reversalFailureReason: overrides.reversalFailureReason ?? null,
      reversalAttemptCount: overrides.reversalAttemptCount ?? 0,
      reversedAt: overrides.reversedAt ?? null,
      createdAt: overrides.createdAt ?? now,
      updatedAt: overrides.updatedAt ?? now,
    };
    this.byId.set(record.id, record);
    return record;
  }
}
