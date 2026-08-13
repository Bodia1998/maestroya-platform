import { beforeEach, describe, expect, it } from "vitest";

import { CheckPayoutEligibilityUseCase } from "@/application/use-cases/verification/check-payout-eligibility.use-case";
import { RefreshVerificationStatusUseCase } from "@/application/use-cases/verification/refresh-verification-status.use-case";
import { StartProfessionalVerificationUseCase } from "@/application/use-cases/verification/start-professional-verification.use-case";
import { SynchronizeVerificationUseCase } from "@/application/use-cases/verification/synchronize-verification.use-case";
import { ConflictError } from "@/domain/errors/domain-error";
import { ProfessionalVerificationStatusChanged } from "@/domain/events/professional-verification-status-changed";
import { SynchronousEventBus } from "@/infrastructure/events/synchronous-event-bus";
import {
  FakeAdminAuditLogRepository,
  FakeNotificationCreator,
  FakeProfessionalRepository,
  FakeProfessionalVerificationRepository,
  FakeVerificationProvider,
} from "./fakes";

/**
 * Integration tests for Module 59 — Professional Verification (Persona):
 * the provider-driven start/refresh/synchronize/payout-eligibility use
 * cases, exercised against the real domain rules with fake repositories/
 * provider swapped in — same pattern as verification-flows.test.ts (Module
 * 17), whose fakes this file reuses.
 */
function makeContext() {
  const professionals = new FakeProfessionalRepository();
  const verifications = new FakeProfessionalVerificationRepository(professionals);
  const auditLog = new FakeAdminAuditLogRepository();
  const notifications = new FakeNotificationCreator();
  const provider = new FakeVerificationProvider();
  const eventBus = new SynchronousEventBus();

  const refresh = new RefreshVerificationStatusUseCase(verifications, professionals, provider, auditLog, notifications);

  return {
    professionals,
    verifications,
    auditLog,
    notifications,
    provider,
    eventBus,
    start: new StartProfessionalVerificationUseCase(verifications, professionals, provider, eventBus),
    refresh,
    synchronize: new SynchronizeVerificationUseCase(verifications, refresh),
    payoutEligibility: new CheckPayoutEligibilityUseCase(verifications),
  };
}

function activeProfessional(ctx: ReturnType<typeof makeContext>) {
  return ctx.professionals.seed({ userId: "user-1", status: "ACTIVE" });
}

describe("Module 59 — StartProfessionalVerificationUseCase", () => {
  let ctx: ReturnType<typeof makeContext>;
  beforeEach(() => {
    ctx = makeContext();
  });

  it("opens a fresh case and moves it to PENDING with the provider linked", async () => {
    activeProfessional(ctx);

    const { verification, verificationUrl } = await ctx.start.execute({
      userId: "user-1",
      fullName: "Ana García López",
      countryCode: "ES",
    });

    expect(verification.status).toBe("PENDING");
    expect(verification.provider).toBe("PERSONA");
    expect(verification.providerVerificationId).toBe("fake-inquiry-1");
    expect(verificationUrl).toBe("https://persona.example/verify/1");
    expect(ctx.provider.createCalls).toHaveLength(1);
    expect(ctx.provider.createCalls[0]).toMatchObject({ fullName: "Ana García López", countryCode: "ES" });

    const profile = await ctx.professionals.findByUserId("user-1");
    expect(profile?.verificationStatus).toBe("PENDING");
  });

  it("publishes a SUBMITTED transition auditable through the existing event subscriber wiring", async () => {
    const professional = activeProfessional(ctx);
    let published: unknown;
    ctx.eventBus.subscribe(ProfessionalVerificationStatusChanged, {
      handle: async (event: unknown) => void (published = event),
    });

    await ctx.start.execute({ userId: "user-1", fullName: "Ana García", countryCode: "ES" });

    expect(published).toMatchObject({ transition: "SUBMITTED", professionalProfileId: professional.id });
  });

  it("rejects starting when the professional has no active profile", async () => {
    await expect(ctx.start.execute({ userId: "ghost", fullName: "A B", countryCode: "ES" })).rejects.toThrow();
  });

  it("rejects starting when the existing case is not in a startable state", async () => {
    activeProfessional(ctx);
    const v = await ctx.verifications.create((await ctx.professionals.findByUserId("user-1"))!.id);
    await ctx.verifications.updateStatus(v.id, { status: "PENDING", submittedAt: new Date() });

    await expect(ctx.start.execute({ userId: "user-1", fullName: "Ana García", countryCode: "ES" })).rejects.toBeInstanceOf(
      ConflictError,
    );
  });
});

describe("Module 59 — RefreshVerificationStatusUseCase", () => {
  let ctx: ReturnType<typeof makeContext>;
  beforeEach(() => {
    ctx = makeContext();
  });

  it("applies an APPROVED transition when the provider reports VERIFIED", async () => {
    activeProfessional(ctx);
    const { verification } = await ctx.start.execute({ userId: "user-1", fullName: "Ana García", countryCode: "ES" });

    ctx.provider.nextOutcome = "VERIFIED";
    ctx.provider.nextRawStatus = "completed";
    const result = await ctx.refresh.execute(verification.id);

    expect(result.changed).toBe(true);
    expect(result.verification.status).toBe("APPROVED");
    expect(result.verification.expiresAt).not.toBeNull();

    const profile = await ctx.professionals.findByUserId("user-1");
    expect(profile?.verificationStatus).toBe("VERIFIED");
    expect(ctx.auditLog.actions()).toContain("VERIFICATION_APPROVED");
    expect(ctx.notifications.events.some((e) => e.type === "VERIFICATION_APPROVED")).toBe(true);
  });

  it("applies a REJECTED transition when the provider reports REJECTED", async () => {
    activeProfessional(ctx);
    const { verification } = await ctx.start.execute({ userId: "user-1", fullName: "Ana García", countryCode: "ES" });

    ctx.provider.nextOutcome = "REJECTED";
    ctx.provider.nextRawStatus = "failed";
    ctx.provider.nextFailureReason = "Document photo was blurry.";
    const result = await ctx.refresh.execute(verification.id);

    expect(result.verification.status).toBe("REJECTED");
    expect(result.verification.rejectionReason).toBe("Document photo was blurry.");
    const profile = await ctx.professionals.findByUserId("user-1");
    expect(profile?.verificationStatus).toBe("REJECTED");
  });

  it("is a no-op sync (changed: false) while the provider is still running", async () => {
    activeProfessional(ctx);
    const { verification } = await ctx.start.execute({ userId: "user-1", fullName: "Ana García", countryCode: "ES" });

    ctx.provider.nextOutcome = "PENDING";
    const result = await ctx.refresh.execute(verification.id);

    expect(result.changed).toBe(false);
    expect(result.verification.status).toBe("PENDING");
    expect(result.verification.providerSyncedAt).not.toBeNull();
  });

  it("is a no-op for a MANUAL-provider case", async () => {
    activeProfessional(ctx);
    const v = await ctx.verifications.create((await ctx.professionals.findByUserId("user-1"))!.id);

    const result = await ctx.refresh.execute(v.id);
    expect(result.changed).toBe(false);
    expect(ctx.provider.refreshCalls).toHaveLength(0);
  });
});

describe("Module 59 — SynchronizeVerificationUseCase", () => {
  it("syncs every syncable case and reports a summary", async () => {
    const ctx = makeContext();
    activeProfessional(ctx);
    const { verification } = await ctx.start.execute({ userId: "user-1", fullName: "Ana García", countryCode: "ES" });

    ctx.provider.nextOutcome = "VERIFIED";
    const summary = await ctx.synchronize.execute();

    expect(summary.checked).toBe(1);
    expect(summary.changed).toBe(1);
    expect(summary.failed).toBe(0);

    const updated = await ctx.verifications.findById(verification.id);
    expect(updated?.status).toBe("APPROVED");
  });

  it("counts a per-case provider failure without aborting the batch", async () => {
    const ctx = makeContext();
    activeProfessional(ctx);
    await ctx.start.execute({ userId: "user-1", fullName: "Ana García", countryCode: "ES" });

    ctx.provider.refreshStatus = async () => {
      throw new Error("Persona is down");
    };

    const summary = await ctx.synchronize.execute();
    expect(summary.checked).toBe(1);
    expect(summary.failed).toBe(1);
    expect(summary.errors[0]?.message).toContain("Persona is down");
  });
});

describe("Module 59 — CheckPayoutEligibilityUseCase", () => {
  it("blocks payouts for a professional with no verification case", async () => {
    const ctx = makeContext();
    const professional = activeProfessional(ctx);

    const result = await ctx.payoutEligibility.execute(professional.id);
    expect(result.eligible).toBe(false);
    expect(result.status).toBe("NOT_STARTED");
  });

  it("blocks payouts while PENDING and allows them once APPROVED", async () => {
    const ctx = makeContext();
    activeProfessional(ctx);
    const { verification } = await ctx.start.execute({ userId: "user-1", fullName: "Ana García", countryCode: "ES" });
    const professional = (await ctx.professionals.findByUserId("user-1"))!;

    let eligibility = await ctx.payoutEligibility.execute(professional.id);
    expect(eligibility.eligible).toBe(false);
    expect(eligibility.status).toBe("PENDING");

    ctx.provider.nextOutcome = "VERIFIED";
    await ctx.refresh.execute(verification.id);

    eligibility = await ctx.payoutEligibility.execute(professional.id);
    expect(eligibility.eligible).toBe(true);
    expect(eligibility.status).toBe("APPROVED");
  });
});
