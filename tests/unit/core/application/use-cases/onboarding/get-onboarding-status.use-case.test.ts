import { describe, expect, it } from "vitest";

import { GetOnboardingStatusUseCase } from "@/application/use-cases/onboarding/get-onboarding-status.use-case";
import { ValidationError } from "@/domain/errors/domain-error";
import {
  FakeAddressRepository,
  FakeConsentRepository,
  FakeProfessionalOnboardingRepository,
  FakeProfessionalRepository,
  FakeProfessionalVerificationRepository,
} from "./fakes";

function makeContext() {
  const onboardings = new FakeProfessionalOnboardingRepository();
  const professionals = new FakeProfessionalRepository();
  const addresses = new FakeAddressRepository();
  const consents = new FakeConsentRepository();
  const verifications = new FakeProfessionalVerificationRepository();
  const useCase = new GetOnboardingStatusUseCase(onboardings, professionals, addresses, consents, verifications);
  return { onboardings, professionals, addresses, consents, verifications, useCase };
}

describe("GetOnboardingStatusUseCase (Module 62)", () => {
  it("throws ValidationError when the user has no professional profile", async () => {
    const { useCase } = makeContext();
    await expect(useCase.execute("no-such-user")).rejects.toThrow(ValidationError);
  });

  it("reports every step incomplete for a brand-new professional", async () => {
    const { professionals, useCase } = makeContext();
    professionals.seed({ userId: "user-1" });

    const result = await useCase.execute("user-1");

    expect(result.progress.isEligibleForActivation).toBe(false);
    expect(result.progress.completedStepCount).toBe(0);
    expect(result.onboarding).toBeNull();
    expect(result.payoutAccount).toBeNull();
  });

  it("reports every step complete once terms, privacy, identity, profile, and payout are all satisfied", async () => {
    const { professionals, addresses, consents, verifications, onboardings, useCase } = makeContext();
    const professional = professionals.seed({
      userId: "user-1",
      businessName: "Acme Plumbing",
      bio: "We fix pipes",
      contactPhone: "+34600000000",
      serviceRadiusKm: 20,
      yearsExperience: 5,
      categoryIds: ["cat-1"],
    });
    await addresses.upsertPrimaryForUser("user-1", {
      line1: "Calle Mayor 1",
      city: "Madrid",
      postalCode: "28001",
      country: "ES",
    });
    await consents.create({ userId: "user-1", type: "TERMS_OF_SERVICE", version: "v1", grantedAt: new Date() });
    await consents.create({ userId: "user-1", type: "PRIVACY_POLICY", version: "v1", grantedAt: new Date() });
    verifications.seedApproved(professional.id);
    // Module 74 — Business Registration Enforcement.
    verifications.seedDocument(professional.id, "BUSINESS_REGISTRATION");
    await onboardings.create(professional.id);
    await onboardings.upsertPayoutAccount({
      professionalProfileId: professional.id,
      method: "IBAN",
      status: "PENDING",
      accountHolderName: "Jane Doe",
      ibanLast4: "1332",
      ibanHash: "hash",
    });

    const result = await useCase.execute("user-1");

    expect(result.progress.isEligibleForActivation).toBe(true);
    expect(result.identityVerificationStatus).toBe("APPROVED");
  });
});
