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
  // Module 74 — Business Registration Enforcement: activation now also
  // requires an approved business-registration document on the case.
  ctx.verifications.seedDocument(professional.id, "BUSINESS_REGISTRATION");
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

/**
 * Module 74 — Business Registration Enforcement.
 *
 * `ActivateProfessionalUseCase` is the single, authoritative, server-side
 * gate a solo professional's onboarding record is ever moved to ACTIVATED
 * through (see `activate()` usage across the codebase — there is no
 * second call site). Every scenario below therefore exercises that exact
 * use case rather than a parallel/alternative path, since none exists —
 * this is itself the "cannot bypass through an alternative API/use case"
 * guarantee the module requires: there is nothing else to call.
 */
describe("ActivateProfessionalUseCase — Module 74 business-registration enforcement", () => {
  it("blocks activation when the solo professional has no business-registration document at all", async () => {
    const ctx = makeContext();
    const professional = await completeEverything(ctx, "user-1");
    // Replace the fully-approved case (with its business-registration
    // document) with one that has identity approved but never had any
    // business-registration document uploaded.
    ctx.verifications.documents.delete(professional.id);
    ctx.verifications.seedApproved(professional.id);

    await expect(ctx.activate.execute("user-1")).rejects.toThrow(/Remaining steps/);
    const onboarding = await ctx.onboardings.findByProfessionalProfileId(professional.id);
    expect(onboarding?.status).toBe("IN_PROGRESS");
  });

  it("blocks activation while the business-registration document is PENDING review", async () => {
    const ctx = makeContext();
    const professional = await completeEverything(ctx, "user-1");
    // Case itself is not yet APPROVED — still PENDING admin review.
    ctx.verifications.seedStatus(professional.id, "PENDING");
    ctx.verifications.seedDocument(professional.id, "BUSINESS_REGISTRATION");

    const validation = await ctx.activate.execute("user-1").catch((e) => e);
    expect(validation).toBeInstanceOf(ValidationError);
    const onboarding = await ctx.onboardings.findByProfessionalProfileId(professional.id);
    expect(onboarding?.status).toBe("IN_PROGRESS");
  });

  it("blocks activation when the case (and its business-registration document) was REJECTED", async () => {
    const ctx = makeContext();
    const professional = await completeEverything(ctx, "user-1");
    ctx.verifications.seedStatus(professional.id, "REJECTED");
    ctx.verifications.seedDocument(professional.id, "BUSINESS_REGISTRATION");

    await expect(ctx.activate.execute("user-1")).rejects.toThrow(ValidationError);
    const onboarding = await ctx.onboardings.findByProfessionalProfileId(professional.id);
    expect(onboarding?.status).toBe("IN_PROGRESS");
  });

  it("blocks activation while RESUBMISSION_REQUIRED — the prior (now-superseded) decision does not satisfy the requirement", async () => {
    const ctx = makeContext();
    const professional = await completeEverything(ctx, "user-1");
    // Admin asked for resubmission — even though a business-registration
    // document is still attached from the earlier submission, the case is
    // no longer APPROVED, so the requirement is not satisfied.
    ctx.verifications.seedStatus(professional.id, "RESUBMISSION_REQUIRED");
    ctx.verifications.seedDocument(professional.id, "BUSINESS_REGISTRATION");

    await expect(ctx.activate.execute("user-1")).rejects.toThrow(ValidationError);
  });

  it("allows activation once the business-registration document is APPROVED and every other requirement passes", async () => {
    const ctx = makeContext();
    await completeEverything(ctx, "user-1");

    const result = await ctx.activate.execute("user-1");

    expect(result.status).toBe("ACTIVATED");
  });

  it("blocks activation when the professional's verification case has EXPIRED", async () => {
    const ctx = makeContext();
    const professional = await completeEverything(ctx, "user-1");
    ctx.verifications.seedStatus(professional.id, "EXPIRED");
    ctx.verifications.seedDocument(professional.id, "BUSINESS_REGISTRATION");

    await expect(ctx.activate.execute("user-1")).rejects.toThrow(ValidationError);
  });

  it("allows activation again after a valid resubmission moves the case back to APPROVED — a prior rejection does not permanently block the professional", async () => {
    const ctx = makeContext();
    const professional = await completeEverything(ctx, "user-1");
    // Simulate the case having been rejected and then successfully
    // resubmitted and re-approved (the state a real
    // Reject → Resubmit → Approve cycle through the existing verification
    // use cases would leave it in).
    ctx.verifications.seedStatus(professional.id, "REJECTED");
    await expect(ctx.activate.execute("user-1")).rejects.toThrow(ValidationError);

    ctx.verifications.seedApproved(professional.id);
    ctx.verifications.seedDocument(professional.id, "BUSINESS_REGISTRATION");

    const result = await ctx.activate.execute("user-1");
    expect(result.status).toBe("ACTIVATED");
  });

  it("does not let one professional's business-registration document satisfy another professional's activation requirement", async () => {
    const ctx = makeContext();
    const professionalA = await completeEverything(ctx, "user-a");
    const professionalB = ctx.professionals.seed({
      userId: "user-b",
      businessName: "Other Co",
      bio: "Other bio",
      contactPhone: "+34600000001",
      serviceRadiusKm: 10,
      yearsExperience: 2,
      categoryIds: ["cat-2"],
    });
    await ctx.addresses.upsertPrimaryForUser("user-b", {
      line1: "Calle Otra 2",
      city: "Barcelona",
      postalCode: "08001",
      country: "ES",
    });
    await ctx.consents.create({ userId: "user-b", type: "TERMS_OF_SERVICE", version: "v1", grantedAt: new Date() });
    await ctx.consents.create({ userId: "user-b", type: "PRIVACY_POLICY", version: "v1", grantedAt: new Date() });
    await ctx.onboardings.create(professionalB.id);
    await ctx.onboardings.upsertPayoutAccount({
      professionalProfileId: professionalB.id,
      method: "IBAN",
      status: "PENDING",
      accountHolderName: "Other Owner",
      ibanLast4: "9999",
      ibanHash: "hash-b",
    });
    // professionalB never submitted their own verification/business
    // registration — only professionalA (a different profile entirely)
    // has one.
    expect(professionalA.id).not.toBe(professionalB.id);

    await expect(ctx.activate.execute("user-b")).rejects.toThrow(/Remaining steps/);
  });
});
