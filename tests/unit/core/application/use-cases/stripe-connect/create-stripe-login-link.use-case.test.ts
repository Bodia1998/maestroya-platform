import { beforeEach, describe, expect, it } from "vitest";

import { CreateStripeLoginLinkUseCase } from "@/application/use-cases/stripe-connect/create-stripe-login-link.use-case";
import { StripeConnectError } from "@/domain/errors/domain-error";
import { FakeProfessionalOnboardingRepository, FakeProfessionalRepository } from "../onboarding/fakes";
import { FakeStripeConnectGateway } from "./fakes";

describe("CreateStripeLoginLinkUseCase (Module 71)", () => {
  let professionals: FakeProfessionalRepository;
  let onboardings: FakeProfessionalOnboardingRepository;
  let gateway: FakeStripeConnectGateway;
  let useCase: CreateStripeLoginLinkUseCase;

  beforeEach(() => {
    professionals = new FakeProfessionalRepository();
    onboardings = new FakeProfessionalOnboardingRepository();
    gateway = new FakeStripeConnectGateway();
    useCase = new CreateStripeLoginLinkUseCase(professionals, onboardings, gateway);
  });

  it("throws ValidationError when no connected account exists yet", async () => {
    const professional = professionals.seed({ userId: "user-1" });
    await onboardings.upsertPayoutAccount({
      professionalProfileId: professional.id,
      method: "STRIPE_EXPRESS",
      status: "PENDING",
      accountHolderName: "Ana García",
      stripeExpressStatus: "PENDING",
    });

    await expect(useCase.execute("user-1")).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("returns a dashboard login link for an onboarded connected account", async () => {
    const professional = professionals.seed({ userId: "user-1" });
    await onboardings.upsertPayoutAccount({
      professionalProfileId: professional.id,
      method: "STRIPE_EXPRESS",
      status: "PENDING",
      accountHolderName: "Ana García",
      stripeExpressStatus: "READY",
    });
    await onboardings.updateStripeConnectAccount(professional.id, { stripeExpressAccountId: "acct_1" });

    const result = await useCase.execute("user-1");
    expect(result.url).toBe("https://connect.stripe.com/express/acct_1");
  });

  it("propagates a StripeConnectError from the gateway without wrapping it", async () => {
    const professional = professionals.seed({ userId: "user-1" });
    await onboardings.upsertPayoutAccount({
      professionalProfileId: professional.id,
      method: "STRIPE_EXPRESS",
      status: "PENDING",
      accountHolderName: "Ana García",
      stripeExpressStatus: "PENDING",
    });
    await onboardings.updateStripeConnectAccount(professional.id, { stripeExpressAccountId: "acct_1" });
    gateway.nextError = new StripeConnectError("INVALID_REQUEST", "Account has not completed onboarding.", false);

    await expect(useCase.execute("user-1")).rejects.toBeInstanceOf(StripeConnectError);
  });
});
