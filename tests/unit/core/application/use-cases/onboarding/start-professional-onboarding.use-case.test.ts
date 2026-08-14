import { describe, expect, it } from "vitest";

import { StartProfessionalOnboardingUseCase } from "@/application/use-cases/onboarding/start-professional-onboarding.use-case";
import { ValidationError } from "@/domain/errors/domain-error";
import { FakeProfessionalOnboardingRepository, FakeProfessionalRepository } from "./fakes";

describe("StartProfessionalOnboardingUseCase (Module 62)", () => {
  it("throws ValidationError when the user has no professional profile yet", async () => {
    const useCase = new StartProfessionalOnboardingUseCase(
      new FakeProfessionalOnboardingRepository(),
      new FakeProfessionalRepository(),
    );

    await expect(useCase.execute("user-without-profile")).rejects.toThrow(ValidationError);
  });

  it("creates a fresh IN_PROGRESS onboarding record for a professional with a profile", async () => {
    const professionals = new FakeProfessionalRepository();
    const professional = professionals.seed({ userId: "user-1" });
    const onboardings = new FakeProfessionalOnboardingRepository();
    const useCase = new StartProfessionalOnboardingUseCase(onboardings, professionals);

    const result = await useCase.execute("user-1");

    expect(result.status).toBe("IN_PROGRESS");
    expect(result.professionalProfileId).toBe(professional.id);
    expect(result.activatedAt).toBeNull();
  });

  it("is idempotent — a second call returns the same record rather than creating another", async () => {
    const professionals = new FakeProfessionalRepository();
    professionals.seed({ userId: "user-1" });
    const onboardings = new FakeProfessionalOnboardingRepository();
    const useCase = new StartProfessionalOnboardingUseCase(onboardings, professionals);

    const first = await useCase.execute("user-1");
    const second = await useCase.execute("user-1");

    expect(second.id).toBe(first.id);
    expect(onboardings.onboardings.size).toBe(1);
  });
});
