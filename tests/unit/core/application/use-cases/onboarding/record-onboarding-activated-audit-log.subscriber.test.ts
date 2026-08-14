import { describe, expect, it } from "vitest";

import { RecordOnboardingActivatedAuditLogSubscriber } from "@/application/use-cases/onboarding/record-onboarding-activated-audit-log.subscriber";
import { ProfessionalOnboardingActivated } from "@/domain/events/professional-onboarding-activated";
import { RecordingAuditLogRepository } from "./fakes";

describe("RecordOnboardingActivatedAuditLogSubscriber (Module 62)", () => {
  it("records an ONBOARDING_ACTIVATED entry with the professional as the actor", async () => {
    const auditLog = new RecordingAuditLogRepository();
    const subscriber = new RecordOnboardingActivatedAuditLogSubscriber(auditLog);
    const activatedAt = new Date("2026-08-14T00:00:00.000Z");

    await subscriber.handle(new ProfessionalOnboardingActivated("onboarding-1", "profile-1", "user-1", activatedAt));

    expect(auditLog.entries).toHaveLength(1);
    expect(auditLog.entries[0]).toMatchObject({
      adminUserId: "user-1",
      action: "ONBOARDING_ACTIVATED",
      targetType: "ProfessionalOnboarding",
      targetId: "onboarding-1",
      metadata: { professionalProfileId: "profile-1", activatedAt: activatedAt.toISOString() },
    });
  });

  it("propagates a repository failure rather than swallowing it", async () => {
    const throwing = {
      record: async () => {
        throw new Error("database unreachable");
      },
      list: async () => [],
    };
    const subscriber = new RecordOnboardingActivatedAuditLogSubscriber(throwing);

    await expect(
      subscriber.handle(new ProfessionalOnboardingActivated("onboarding-1", "profile-1", "user-1", new Date())),
    ).rejects.toThrow("database unreachable");
  });
});
