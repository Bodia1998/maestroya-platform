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
