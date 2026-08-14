import { describe, expect, it } from "vitest";

import { AcceptOnboardingPrivacyPolicyUseCase } from "@/application/use-cases/onboarding/accept-onboarding-privacy-policy.use-case";
import { NullEventBus } from "@/application/ports/null-event-bus";
import { FakeConsentRepository } from "./fakes";

describe("AcceptOnboardingPrivacyPolicyUseCase (Module 62)", () => {
  it("records a PRIVACY_POLICY consent with acceptedAt and version, no ipHash/userAgent", async () => {
    const consents = new FakeConsentRepository();
    const useCase = new AcceptOnboardingPrivacyPolicyUseCase(consents, new NullEventBus());

    const record = await useCase.execute("user-1", { version: "2026-01-01" });

    expect(record.type).toBe("PRIVACY_POLICY");
    expect(record.version).toBe("2026-01-01");
    expect(record.grantedAt).toBeInstanceOf(Date);
    expect(record.ipHash).toBeNull();
    expect(record.userAgent).toBeNull();
  });

  it("is idempotent — a second acceptance returns the existing active consent", async () => {
    const consents = new FakeConsentRepository();
    const useCase = new AcceptOnboardingPrivacyPolicyUseCase(consents, new NullEventBus());

    const first = await useCase.execute("user-1", { version: "2026-01-01" });
    const second = await useCase.execute("user-1", { version: "2026-02-01" });

    expect(second.id).toBe(first.id);
    expect(consents.records).toHaveLength(1);
  });

  it("does not interfere with a TERMS_OF_SERVICE consent for the same user", async () => {
    const consents = new FakeConsentRepository();
    await consents.create({ userId: "user-1", type: "TERMS_OF_SERVICE", version: "v1", grantedAt: new Date() });
    const useCase = new AcceptOnboardingPrivacyPolicyUseCase(consents, new NullEventBus());

    await useCase.execute("user-1", { version: "2026-01-01" });

    expect(consents.records).toHaveLength(2);
  });
});
