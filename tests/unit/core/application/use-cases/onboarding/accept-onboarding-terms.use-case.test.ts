import { describe, expect, it } from "vitest";

import { AcceptOnboardingTermsUseCase } from "@/application/use-cases/onboarding/accept-onboarding-terms.use-case";
import { NullEventBus } from "@/application/ports/null-event-bus";
import { SynchronousEventBus } from "@/infrastructure/events/synchronous-event-bus";
import { ConsentGranted } from "@/domain/events/consent-granted";
import { FakeConsentRepository } from "./fakes";

describe("AcceptOnboardingTermsUseCase (Module 62)", () => {
  it("records a TERMS_OF_SERVICE consent with a hashed ipHash and truncated userAgent", async () => {
    const consents = new FakeConsentRepository();
    const useCase = new AcceptOnboardingTermsUseCase(consents, new NullEventBus(), "pepper");

    const record = await useCase.execute("user-1", {
      version: "2026-01-01",
      rawIp: "1.2.3.4",
      userAgent: "Mozilla/5.0",
    });

    expect(record.type).toBe("TERMS_OF_SERVICE");
    expect(record.version).toBe("2026-01-01");
    expect(record.ipHash).not.toBeNull();
    expect(record.ipHash).not.toContain("1.2.3.4");
    expect(record.userAgent).toBe("Mozilla/5.0");
  });

  it("leaves ipHash/userAgent null when no request context is supplied", async () => {
    const consents = new FakeConsentRepository();
    const useCase = new AcceptOnboardingTermsUseCase(consents, new NullEventBus(), "pepper");

    const record = await useCase.execute("user-1", { version: "2026-01-01" });

    expect(record.ipHash).toBeNull();
    expect(record.userAgent).toBeNull();
  });

  it("is idempotent — a second acceptance returns the existing active consent unchanged", async () => {
    const consents = new FakeConsentRepository();
    const useCase = new AcceptOnboardingTermsUseCase(consents, new NullEventBus(), "pepper");

    const first = await useCase.execute("user-1", { version: "2026-01-01", rawIp: "1.2.3.4" });
    const second = await useCase.execute("user-1", { version: "2026-02-01", rawIp: "5.6.7.8" });

    expect(second.id).toBe(first.id);
    expect(second.version).toBe("2026-01-01");
    expect(consents.records).toHaveLength(1);
  });

  it("publishes ConsentGranted", async () => {
    const consents = new FakeConsentRepository();
    const eventBus = new SynchronousEventBus();
    const published: ConsentGranted[] = [];
    eventBus.subscribe(ConsentGranted, { handle: async (e) => void published.push(e) });
    const useCase = new AcceptOnboardingTermsUseCase(consents, eventBus, "pepper");

    await useCase.execute("user-1", { version: "2026-01-01" });

    expect(published).toHaveLength(1);
    expect(published[0]!.type).toBe("TERMS_OF_SERVICE");
  });
});
