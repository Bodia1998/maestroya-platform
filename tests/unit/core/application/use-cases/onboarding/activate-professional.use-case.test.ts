import { describe, expect, it } from "vitest";

import { ActivateProfessionalUseCase } from "@/application/use-cases/onboarding/activate-professional.use-case";
import { GetOnboardingStatusUseCase } from "@/application/use-cases/onboarding/get-onboarding-status.use-case";
import { ValidateProfessionalActivationUseCase } from "@/application/use-cases/onboarding/validate-professional-activation.use-case";
import { NullEventBus } from "@/application/ports/null-event-bus";
import { SynchronousEventBus } from "@/infrastructure/events/synchronous-event-bus";
import { ValidationError } from "@/domain/errors/domain-error";
import { ProfessionalOnboardingActivated } from "@/domain/events/professional-onboarding-activated";
import {
  FakeAddressRepository,
  FakeConsentRepository,
  FakeProfessionalOnboardingRepository,
  FakeProfessionalRepository,
  FakeProfessionalVerificationRepository,
} from "./fakes";

function makeContext(eventBus = new NullEventBus()) {
  const onboardings = new FakeProfessionalOnboardingRepository();
  const professionals = new FakeProfessionalRepository();
  const addresses = new FakeAddressRepository();
  const consents = new FakeConsentRepository();
  const verifications = new FakeProfessionalVerificationRepository();
  const getStatus = new GetOnboardingStatusUseCase(onboardings, professionals, addresses, consents, verifications);
  const validate = new ValidateProfessionalActivationUseCase(getStatus);
  const activate = new ActivateProfessionalUseCase(onboardings, professionals, getStatus, validate, eventBus);
  return { onboardings, professionals, addresses, consents, verifications, activate };
}

async function completeEverything(ctx: ReturnType<typeof makeContext>, userId: string) {
  const professional = ctx.professionals.seed({
    userId,
    businessName: "Acme Plumbing",
    bio: "We fix pipes",
    contactPhone: "+34600000000",
    serviceRadiusKm: 20,
    yearsExperience: 5,
    categoryIds: ["cat-1"],
  });
  await ctx.addresses.upsertPrimaryForUser(userId, {
    line1: "Calle Mayor 1",
    city: "Madrid",
    postalCode: "28001",
    country: "ES",
  });
  await ctx.consents.create({ userId, type: "TERMS_OF_SERVICE", version: "v1", grantedAt: new Date() });
  await ctx.consents.create({ userId, type: "PRIVACY_POLICY", version: "v1", grantedAt: new Date() });
  ctx.verifications.seedApproved(professional.id);
  await ctx.onboardings.create(professional.id);
  await ctx.onboardings.upsertPayoutAccount({
    professionalProfileId: professional.id,
    method: "IBAN",
    status: "PENDING",
    accountHolderName: "Jane Doe",
    ibanLast4: "1332",
    ibanHash: "hash",
  });
  return professional;
}

describe("ActivateProfessionalUseCase (Module 62)", () => {
  it("throws ValidationError when the professional has never started onboarding", async () => {
    const ctx = makeContext();
    ctx.professionals.seed({ userId: "user-1" });

    await expect(ctx.activate.execute("user-1")).rejects.toThrow(ValidationError);
  });

  it("throws ValidationError, listing missing steps, when onboarding is incomplete — no shortcuts", async () => {
    const ctx = makeContext();
    const professional = ctx.professionals.seed({ userId: "user-1" });
    await ctx.onboardings.create(professional.id);

    await expect(ctx.activate.execute("user-1")).rejects.toThrow(/Remaining steps/);
  });

  it("activates once every requirement is satisfied and publishes ProfessionalOnboardingActivated", async () => {
    const eventBus = new SynchronousEventBus();
    const published: ProfessionalOnboardingActivated[] = [];
    eventBus.subscribe(ProfessionalOnboardingActivated, { handle: async (e) => void published.push(e) });
    const ctx = makeContext(eventBus);
    await completeEverything(ctx, "user-1");

    const result = await ctx.activate.execute("user-1");

    expect(result.status).toBe("ACTIVATED");
    expect(result.activatedAt).not.toBeNull();
    expect(published).toHaveLength(1);
    expect(published[0]!.userId).toBe("user-1");
  });

  it("is idempotent — activating an already-ACTIVATED record does not re-publish the event", async () => {
    const eventBus = new SynchronousEventBus();
    const published: ProfessionalOnboardingActivated[] = [];
    eventBus.subscribe(ProfessionalOnboardingActivated, { handle: async (e) => void published.push(e) });
    const ctx = makeContext(eventBus);
    await completeEverything(ctx, "user-1");

    await ctx.activate.execute("user-1");
    const second = await ctx.activate.execute("user-1");

    expect(second.status).toBe("ACTIVATED");
    expect(published).toHaveLength(1);
  });
});
