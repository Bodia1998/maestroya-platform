import { describe, expect, it } from "vitest";

import { AcceptOnboardingPrivacyPolicyUseCase } from "@/application/use-cases/onboarding/accept-onboarding-privacy-policy.use-case";
import { AcceptOnboardingTermsUseCase } from "@/application/use-cases/onboarding/accept-onboarding-terms.use-case";
import { ActivateProfessionalUseCase } from "@/application/use-cases/onboarding/activate-professional.use-case";
import { GetOnboardingStatusUseCase } from "@/application/use-cases/onboarding/get-onboarding-status.use-case";
import { SetPayoutDestinationUseCase } from "@/application/use-cases/onboarding/set-payout-destination.use-case";
import { StartProfessionalOnboardingUseCase } from "@/application/use-cases/onboarding/start-professional-onboarding.use-case";
import { ValidateProfessionalActivationUseCase } from "@/application/use-cases/onboarding/validate-professional-activation.use-case";
import { ValidationError } from "@/domain/errors/domain-error";
import { ProfessionalOnboardingActivated } from "@/domain/events/professional-onboarding-activated";
import { SynchronousEventBus } from "@/infrastructure/events/synchronous-event-bus";
import { IbanPayoutProvider } from "@/infrastructure/payout/iban-payout-provider";
import {
  FakeAddressRepository,
  FakeConsentRepository,
  FakeProfessionalOnboardingRepository,
  FakeProfessionalRepository,
  FakeProfessionalVerificationRepository,
} from "./fakes";

/**
 * Module 62 — Professional Onboarding: an end-to-end integration test
 * exercising the real orchestration across every use case this module
 * ships — start, accept terms, accept privacy, add a payout destination
 * (through the real `IbanPayoutProvider`, not a stub), reach identity
 * verification via the existing Module 17/59 repository, complete the
 * profile through the existing `ProfessionalRepository`, then validate and
 * activate — with only storage swapped out for in-memory fakes. Same
 * pattern `tests/integration/verification/provider-verification-flows.test.ts`
 * follows for Module 59.
 */
describe("Professional Onboarding end-to-end flow (Module 62)", () => {
  it("walks a professional from a fresh profile through to ACTIVATED, in order, with no shortcuts", async () => {
    const professionals = new FakeProfessionalRepository();
    const addresses = new FakeAddressRepository();
    const consents = new FakeConsentRepository();
    const verifications = new FakeProfessionalVerificationRepository();
    const onboardings = new FakeProfessionalOnboardingRepository();
    const eventBus = new SynchronousEventBus();
    const activationEvents: ProfessionalOnboardingActivated[] = [];
    eventBus.subscribe(ProfessionalOnboardingActivated, { handle: async (e) => void activationEvents.push(e) });

    const professional = professionals.seed({ userId: "user-1" });

    const start = new StartProfessionalOnboardingUseCase(onboardings, professionals);
    const acceptTerms = new AcceptOnboardingTermsUseCase(consents, eventBus, "test-pepper");
    const acceptPrivacy = new AcceptOnboardingPrivacyPolicyUseCase(consents, eventBus);
    const setPayoutDestination = new SetPayoutDestinationUseCase(onboardings, professionals, () => new IbanPayoutProvider("test-pepper"));
    const getStatus = new GetOnboardingStatusUseCase(onboardings, professionals, addresses, consents, verifications);
    const validate = new ValidateProfessionalActivationUseCase(getStatus);
    const activate = new ActivateProfessionalUseCase(onboardings, professionals, getStatus, validate, eventBus);

    // 1. Start onboarding.
    const onboarding = await start.execute("user-1");
    expect(onboarding.status).toBe("IN_PROGRESS");

    // Not yet eligible — nothing else has happened.
    expect((await validate.execute("user-1")).eligible).toBe(false);
    await expect(activate.execute("user-1")).rejects.toThrow(/Remaining steps/);

    // 2. Accept terms.
    await acceptTerms.execute("user-1", { version: "2026-01-01", rawIp: "1.2.3.4", userAgent: "Mozilla/5.0" });

    // 3. Accept privacy policy.
    await acceptPrivacy.execute("user-1", { version: "2026-01-01" });

    // Still missing identity verification, profile completeness, and payout.
    let validation = await validate.execute("user-1");
    expect(validation.eligible).toBe(false);
    expect(validation.missingSteps).toContain("Complete identity verification");
    expect(validation.missingSteps).toContain("Complete your professional profile");
    expect(validation.missingSteps).toContain("Add a payout destination");

    // 4. Persona verification (Module 59) — reused, not reimplemented.
    verifications.seedApproved(professional.id);
    // Module 74 — Business Registration Enforcement: a solo professional
    // must also have an approved business-registration document on the
    // same case before activation is eligible.
    verifications.seedDocument(professional.id, "BUSINESS_REGISTRATION");

    // 5. Complete the professional profile (existing Professional module).
    await professionals.update(professional.id, {
      businessName: "Acme Plumbing",
      bio: "We fix pipes",
      contactPhone: "+34600000000",
      serviceRadiusKm: 20,
    });
    await professionals.updateCategories(professional.id, ["cat-1"]);
    professionals.byId.set(professional.id, { ...professionals.byId.get(professional.id)!, yearsExperience: 5 });
    await addresses.upsertPrimaryForUser("user-1", {
      line1: "Calle Mayor 1",
      city: "Madrid",
      postalCode: "28001",
      country: "ES",
    });

    // 6. Bank account (real IbanPayoutProvider — validates/masks/hashes for real).
    const payoutAccount = await setPayoutDestination.execute("user-1", {
      method: "IBAN",
      accountHolderName: "Jane Doe",
      iban: "ES91 2100 0418 4502 0005 1332",
    });
    expect(payoutAccount.status).toBe("PENDING");
    expect(payoutAccount.ibanLast4).toBe("1332");

    // Now every requirement is satisfied.
    validation = await validate.execute("user-1");
    expect(validation.eligible).toBe(true);
    expect(validation.missingSteps).toHaveLength(0);

    // 7. Final activation.
    const activated = await activate.execute("user-1");
    expect(activated.status).toBe("ACTIVATED");
    expect(activated.activatedAt).not.toBeNull();
    expect(activationEvents).toHaveLength(1);

    // Re-activating is a safe no-op, not a second event.
    await activate.execute("user-1");
    expect(activationEvents).toHaveLength(1);
  });

  it("rejects an invalid IBAN before it ever reaches persistence, leaving the professional un-onboarded for that step", async () => {
    const professionals = new FakeProfessionalRepository();
    professionals.seed({ userId: "user-2" });
    const onboardings = new FakeProfessionalOnboardingRepository();
    const setPayoutDestination = new SetPayoutDestinationUseCase(onboardings, professionals, () => new IbanPayoutProvider("test-pepper"));

    await expect(
      setPayoutDestination.execute("user-2", { method: "IBAN", accountHolderName: "Jane Doe", iban: "GB00INVALID" }),
    ).rejects.toThrow(ValidationError);

    expect(onboardings.payoutAccounts.size).toBe(0);
  });
});
