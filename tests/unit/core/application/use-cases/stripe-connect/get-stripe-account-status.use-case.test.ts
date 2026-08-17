import { beforeEach, describe, expect, it } from "vitest";

import { GetStripeAccountStatusUseCase } from "@/application/use-cases/stripe-connect/get-stripe-account-status.use-case";
import { FakeProfessionalOnboardingRepository, FakeProfessionalRepository } from "../onboarding/fakes";
import { FakeStripeConnectGateway } from "./fakes";

describe("GetStripeAccountStatusUseCase (Module 71)", () => {
  let professionals: FakeProfessionalRepository;
  let onboardings: FakeProfessionalOnboardingRepository;
  let gateway: FakeStripeConnectGateway;
  let useCase: GetStripeAccountStatusUseCase;

  beforeEach(() => {
    professionals = new FakeProfessionalRepository();
    onboardings = new FakeProfessionalOnboardingRepository();
    gateway = new FakeStripeConnectGateway();
    useCase = new GetStripeAccountStatusUseCase(professionals, onboardings, gateway);
  });

  it("throws ValidationError when no payout account exists yet", async () => {
    professionals.seed({ userId: "user-1" });
    await expect(useCase.execute("user-1")).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("returns the local PENDING state without calling Stripe when no connected account has been created yet", async () => {
    const professional = professionals.seed({ userId: "user-1" });
    await onboardings.upsertPayoutAccount({
      professionalProfileId: professional.id,
      method: "STRIPE_EXPRESS",
      status: "PENDING",
      accountHolderName: "Ana García",
      stripeExpressStatus: "PENDING",
    });

    const result = await useCase.execute("user-1");

    expect(result.stripeExpressAccountId).toBeNull();
    expect(result.stripeExpressStatus).toBe("PENDING");
    expect(gateway.retrieveAccountStatusCalls).toHaveLength(0);
  });

  it("promotes to READY once Stripe reports transfers active and payouts enabled", async () => {
    const professional = professionals.seed({ userId: "user-1" });
    await onboardings.upsertPayoutAccount({
      professionalProfileId: professional.id,
      method: "STRIPE_EXPRESS",
      status: "PENDING",
      accountHolderName: "Ana García",
      stripeExpressStatus: "PENDING",
    });
    await onboardings.updateStripeConnectAccount(professional.id, { stripeExpressAccountId: "acct_1" });

    gateway.nextStatus = {
      stripeAccountId: "acct_1",
      detailsSubmitted: true,
      transfersActive: true,
      payoutsEnabled: true,
      requirementsCurrentlyDue: [],
      disabledReason: null,
    };

    const result = await useCase.execute("user-1");

    expect(result.stripeExpressStatus).toBe("READY");
    expect(result.stripeChargesEnabled).toBe(true);
    expect(result.stripePayoutsEnabled).toBe(true);
    expect(result.stripeDetailsSubmitted).toBe(true);
    expect(result.stripeRequirementsCurrentlyDue).toBe(false);
    expect(result.stripeConnectSyncedAt).not.toBeNull();
  });

  it("is READY even with non-blocking requirements currently due, once transfers/payouts are both active", async () => {
    const professional = professionals.seed({ userId: "user-1" });
    await onboardings.upsertPayoutAccount({
      professionalProfileId: professional.id,
      method: "STRIPE_EXPRESS",
      status: "PENDING",
      accountHolderName: "Ana García",
      stripeExpressStatus: "PENDING",
    });
    await onboardings.updateStripeConnectAccount(professional.id, { stripeExpressAccountId: "acct_1" });

    gateway.nextStatus = {
      stripeAccountId: "acct_1",
      detailsSubmitted: true,
      transfersActive: true,
      payoutsEnabled: true,
      requirementsCurrentlyDue: ["individual.verification.document"],
      disabledReason: null,
    };

    const result = await useCase.execute("user-1");

    expect(result.stripeExpressStatus).toBe("READY");
    expect(result.stripeRequirementsCurrentlyDue).toBe(true);
  });

  it("stays PENDING while details have not been submitted, even if transfers/payouts are already enabled", async () => {
    const professional = professionals.seed({ userId: "user-1" });
    await onboardings.upsertPayoutAccount({
      professionalProfileId: professional.id,
      method: "STRIPE_EXPRESS",
      status: "PENDING",
      accountHolderName: "Ana García",
      stripeExpressStatus: "PENDING",
    });
    await onboardings.updateStripeConnectAccount(professional.id, { stripeExpressAccountId: "acct_1" });

    gateway.nextStatus = {
      stripeAccountId: "acct_1",
      detailsSubmitted: false,
      transfersActive: true,
      payoutsEnabled: true,
      requirementsCurrentlyDue: ["individual.verification.document"],
      disabledReason: null,
    };

    const result = await useCase.execute("user-1");

    expect(result.stripeExpressStatus).toBe("PENDING");
    expect(result.stripeRequirementsCurrentlyDue).toBe(true);
  });

  it("stays PENDING when the transfers capability has been disabled/is inactive, even if payouts are enabled", async () => {
    const professional = professionals.seed({ userId: "user-1" });
    await onboardings.upsertPayoutAccount({
      professionalProfileId: professional.id,
      method: "STRIPE_EXPRESS",
      status: "PENDING",
      accountHolderName: "Ana García",
      stripeExpressStatus: "PENDING",
    });
    await onboardings.updateStripeConnectAccount(professional.id, { stripeExpressAccountId: "acct_1" });

    gateway.nextStatus = {
      stripeAccountId: "acct_1",
      detailsSubmitted: true,
      transfersActive: false,
      payoutsEnabled: true,
      requirementsCurrentlyDue: [],
      disabledReason: "requirements.past_due",
    };

    const result = await useCase.execute("user-1");

    expect(result.stripeExpressStatus).toBe("PENDING");
    expect(result.stripeChargesEnabled).toBe(false);
  });

  it("stays PENDING when payouts are disabled, even if the transfers capability is active", async () => {
    const professional = professionals.seed({ userId: "user-1" });
    await onboardings.upsertPayoutAccount({
      professionalProfileId: professional.id,
      method: "STRIPE_EXPRESS",
      status: "PENDING",
      accountHolderName: "Ana García",
      stripeExpressStatus: "PENDING",
    });
    await onboardings.updateStripeConnectAccount(professional.id, { stripeExpressAccountId: "acct_1" });

    gateway.nextStatus = {
      stripeAccountId: "acct_1",
      detailsSubmitted: true,
      transfersActive: true,
      payoutsEnabled: false,
      requirementsCurrentlyDue: [],
      disabledReason: null,
    };

    const result = await useCase.execute("user-1");

    expect(result.stripeExpressStatus).toBe("PENDING");
    expect(result.stripePayoutsEnabled).toBe(false);
  });

  it("is safe to call repeatedly (each call re-syncs from Stripe)", async () => {
    const professional = professionals.seed({ userId: "user-1" });
    await onboardings.upsertPayoutAccount({
      professionalProfileId: professional.id,
      method: "STRIPE_EXPRESS",
      status: "PENDING",
      accountHolderName: "Ana García",
      stripeExpressStatus: "PENDING",
    });
    await onboardings.updateStripeConnectAccount(professional.id, { stripeExpressAccountId: "acct_1" });

    await useCase.execute("user-1");
    await useCase.execute("user-1");

    expect(gateway.retrieveAccountStatusCalls).toEqual(["acct_1", "acct_1"]);
  });

  it("only ever resolves the calling user's own professional profile (authorization boundary)", async () => {
    const professionalA = professionals.seed({ userId: "user-a" });
    professionals.seed({ userId: "user-b" });
    await onboardings.upsertPayoutAccount({
      professionalProfileId: professionalA.id,
      method: "STRIPE_EXPRESS",
      status: "PENDING",
      accountHolderName: "Ana García",
      stripeExpressStatus: "PENDING",
    });

    await expect(useCase.execute("user-b")).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
});
