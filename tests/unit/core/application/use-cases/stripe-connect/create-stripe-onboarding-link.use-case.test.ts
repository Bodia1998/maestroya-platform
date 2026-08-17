import { beforeEach, describe, expect, it } from "vitest";

import { CreateStripeOnboardingLinkUseCase } from "@/application/use-cases/stripe-connect/create-stripe-onboarding-link.use-case";
import { FakeProfessionalOnboardingRepository, FakeProfessionalRepository } from "../onboarding/fakes";
import { FakeStripeConnectGateway } from "./fakes";

describe("CreateStripeOnboardingLinkUseCase (Module 71)", () => {
  let professionals: FakeProfessionalRepository;
  let onboardings: FakeProfessionalOnboardingRepository;
  let gateway: FakeStripeConnectGateway;
  let useCase: CreateStripeOnboardingLinkUseCase;

  beforeEach(() => {
    professionals = new FakeProfessionalRepository();
    onboardings = new FakeProfessionalOnboardingRepository();
    gateway = new FakeStripeConnectGateway();
    useCase = new CreateStripeOnboardingLinkUseCase(professionals, onboardings, gateway, (professionalProfileId) => ({
      refreshUrl: `https://maestroya.example/onboarding/${professionalProfileId}/refresh`,
      returnUrl: `https://maestroya.example/onboarding/${professionalProfileId}/return`,
    }));
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
    expect(gateway.createOnboardingLinkCalls).toHaveLength(0);
  });

  it("requests an onboarding link for the professional's connected account", async () => {
    const professional = professionals.seed({ userId: "user-1" });
    await onboardings.upsertPayoutAccount({
      professionalProfileId: professional.id,
      method: "STRIPE_EXPRESS",
      status: "PENDING",
      accountHolderName: "Ana García",
      stripeExpressStatus: "PENDING",
    });
    await onboardings.updateStripeConnectAccount(professional.id, { stripeExpressAccountId: "acct_1" });

    const result = await useCase.execute("user-1");

    expect(result.url).toBe("https://connect.stripe.com/setup/e/acct_1");
    expect(gateway.createOnboardingLinkCalls).toEqual([
      {
        stripeAccountId: "acct_1",
        options: {
          refreshUrl: `https://maestroya.example/onboarding/${professional.id}/refresh`,
          returnUrl: `https://maestroya.example/onboarding/${professional.id}/return`,
        },
      },
    ]);
  });
});
