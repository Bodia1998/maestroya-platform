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
