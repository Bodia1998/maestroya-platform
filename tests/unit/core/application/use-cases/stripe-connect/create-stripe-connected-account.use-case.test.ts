import { beforeEach, describe, expect, it } from "vitest";

import { CreateStripeConnectedAccountUseCase } from "@/application/use-cases/stripe-connect/create-stripe-connected-account.use-case";
import { FakeProfessionalOnboardingRepository, FakeProfessionalRepository } from "../onboarding/fakes";
import { FakeStripeConnectGateway, FakeUserRepository } from "./fakes";

describe("CreateStripeConnectedAccountUseCase (Module 71)", () => {
  let professionals: FakeProfessionalRepository;
  let onboardings: FakeProfessionalOnboardingRepository;
  let users: FakeUserRepository;
  let gateway: FakeStripeConnectGateway;
  let useCase: CreateStripeConnectedAccountUseCase;

  beforeEach(() => {
    professionals = new FakeProfessionalRepository();
    onboardings = new FakeProfessionalOnboardingRepository();
    users = new FakeUserRepository();
    gateway = new FakeStripeConnectGateway();
    useCase = new CreateStripeConnectedAccountUseCase(professionals, onboardings, users, gateway, "ES");
  });

  it("throws ValidationError when the caller has no professional profile", async () => {
    await expect(useCase.execute("user-without-profile")).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("throws ValidationError when the professional has not selected STRIPE_EXPRESS as their payout method", async () => {
    const professional = professionals.seed({ userId: "user-1" });
    await onboardings.upsertPayoutAccount({
      professionalProfileId: professional.id,
      method: "IBAN",
      status: "PENDING",
      accountHolderName: "Ana García",
      ibanLast4: "1234",
      ibanHash: "hash",
    });

    await expect(useCase.execute("user-1")).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(gateway.createConnectedAccountCalls).toHaveLength(0);
  });

  it("creates a connected account and persists it as PENDING", async () => {
    const professional = professionals.seed({ userId: "user-1" });
    users.seed({
      id: "user-1",
      email: "pro@example.com",
      name: "Ana",
      passwordHash: null,
      emailVerified: null,
      status: "ACTIVE",
    });
    await onboardings.upsertPayoutAccount({
      professionalProfileId: professional.id,
      method: "STRIPE_EXPRESS",
      status: "PENDING",
      accountHolderName: "Ana García",
      stripeExpressStatus: "PENDING",
    });

    const result = await useCase.execute("user-1");

    expect(result.stripeExpressAccountId).toBe("acct_fake");
    expect(result.stripeExpressStatus).toBe("PENDING");
    expect(gateway.createConnectedAccountCalls).toEqual([
      { professionalProfileId: professional.id, email: "pro@example.com", country: "ES" },
    ]);
  });

  it("is idempotent — a second call does not create a second Stripe account", async () => {
    const professional = professionals.seed({ userId: "user-1" });
    users.seed({
      id: "user-1",
      email: "pro@example.com",
      name: "Ana",
      passwordHash: null,
      emailVerified: null,
      status: "ACTIVE",
    });
    await onboardings.upsertPayoutAccount({
      professionalProfileId: professional.id,
      method: "STRIPE_EXPRESS",
      status: "PENDING",
      accountHolderName: "Ana García",
      stripeExpressStatus: "PENDING",
    });

    const first = await useCase.execute("user-1");
    const second = await useCase.execute("user-1");

    expect(gateway.createConnectedAccountCalls).toHaveLength(1);
    expect(second.stripeExpressAccountId).toBe(first.stripeExpressAccountId);
  });
});
