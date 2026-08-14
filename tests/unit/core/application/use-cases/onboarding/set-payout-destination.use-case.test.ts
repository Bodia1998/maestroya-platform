import { describe, expect, it } from "vitest";

import { SetPayoutDestinationUseCase } from "@/application/use-cases/onboarding/set-payout-destination.use-case";
import { ValidationError } from "@/domain/errors/domain-error";
import { FakePayoutProvider, FakeProfessionalOnboardingRepository, FakeProfessionalRepository } from "./fakes";

describe("SetPayoutDestinationUseCase (Module 62)", () => {
  it("throws ValidationError when the user has no professional profile", async () => {
    const useCase = new SetPayoutDestinationUseCase(
      new FakeProfessionalOnboardingRepository(),
      new FakeProfessionalRepository(),
      () => new FakePayoutProvider("IBAN", { method: "IBAN", status: "PENDING", maskedAccount: "****0000", accountHash: "hash", externalReference: null }),
    );

    await expect(
      useCase.execute("no-such-user", { method: "IBAN", accountHolderName: "Jane Doe", iban: "ES9121000418450200051332" }),
    ).rejects.toThrow(ValidationError);
  });

  it("throws ValidationError for method IBAN with no iban supplied", async () => {
    const professionals = new FakeProfessionalRepository();
    professionals.seed({ userId: "user-1" });
    const useCase = new SetPayoutDestinationUseCase(
      new FakeProfessionalOnboardingRepository(),
      professionals,
      () => new FakePayoutProvider("IBAN", { method: "IBAN", status: "PENDING", maskedAccount: "****0000", accountHash: "hash", externalReference: null }),
    );

    await expect(useCase.execute("user-1", { method: "IBAN", accountHolderName: "Jane Doe" })).rejects.toThrow(
      ValidationError,
    );
  });

  it("delegates to the resolved provider and persists the result via upsertPayoutAccount", async () => {
    const professionals = new FakeProfessionalRepository();
    const professional = professionals.seed({ userId: "user-1" });
    const onboardings = new FakeProfessionalOnboardingRepository();
    const useCase = new SetPayoutDestinationUseCase(onboardings, professionals, () =>
      new FakePayoutProvider("IBAN", {
        method: "IBAN",
        status: "PENDING",
        maskedAccount: "****1332",
        accountHash: "hashed-iban",
        externalReference: null,
      }),
    );

    const result = await useCase.execute("user-1", {
      method: "IBAN",
      accountHolderName: "Jane Doe",
      iban: "ES9121000418450200051332",
    });

    expect(result.method).toBe("IBAN");
    expect(result.status).toBe("PENDING");
    expect(result.ibanLast4).toBe("1332");
    expect(result.ibanHash).toBe("hashed-iban");
    expect(onboardings.payoutAccounts.get(professional.id)?.id).toBe(result.id);
  });

  it("routes STRIPE_EXPRESS to the resolved provider without requiring an IBAN", async () => {
    const professionals = new FakeProfessionalRepository();
    professionals.seed({ userId: "user-1" });
    const useCase = new SetPayoutDestinationUseCase(
      new FakeProfessionalOnboardingRepository(),
      professionals,
      () =>
        new FakePayoutProvider("STRIPE_EXPRESS", {
          method: "STRIPE_EXPRESS",
          status: "PENDING",
          maskedAccount: "Stripe Express — pending onboarding",
          accountHash: null,
          externalReference: null,
        }),
    );

    const result = await useCase.execute("user-1", { method: "STRIPE_EXPRESS", accountHolderName: "Jane Doe" });

    expect(result.method).toBe("STRIPE_EXPRESS");
    expect(result.stripeExpressStatus).toBe("PENDING");
    expect(result.ibanLast4).toBeNull();
  });
});
