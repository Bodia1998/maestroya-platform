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

/**
 * Module 98 — Professional Tax & Business Verification: adds an accepted
 * business-registration document to a Persona-driven case the same way a
 * professional would from their own dashboard (Module 17's
 * UploadVerificationDocumentUseCase) — used to satisfy
 * hasBusinessRegistrationDocument before an automated APPROVED outcome is
 * expected to actually verify the profile. See refresh-verification-
 * status.use-case.ts's own doc comment for why this is required.
 */
async function addBusinessRegistrationDocument(ctx: ReturnType<typeof makeContext>, verificationId: string) {
  await ctx.verifications.addDocument({
    verificationId,
    type: "BUSINESS_REGISTRATION",
    fileUrl: "https://example.com/business-registration.pdf",
    originalFilename: "business-registration.pdf",
    mimeType: "application/pdf",
    fileSizeBytes: 1024,
  });
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

  it("applies an APPROVED transition when the provider reports VERIFIED and a business-registration document is present", async () => {
    activeProfessional(ctx);
    const { verification } = await ctx.start.execute({ userId: "user-1", fullName: "Ana García", countryCode: "ES" });
    await addBusinessRegistrationDocument(ctx, verification.id);

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

  // Module 98 — Professional Tax & Business Verification: the exact bypass
  // the audit identified — Persona's identity-only VERIFIED outcome must
  // never, by itself, grant the profile's VERIFIED trust badge. This is the
  // mandatory regression test: Persona identity verification alone must NOT
  // equal professional eligibility.
  it("Module 98: does NOT approve — downgrades to RESUBMISSION_REQUIRED and keeps the profile PENDING — when Persona verifies identity but no business-registration document exists", async () => {
    activeProfessional(ctx);
    const { verification } = await ctx.start.execute({ userId: "user-1", fullName: "Ana García", countryCode: "ES" });

    ctx.provider.nextOutcome = "VERIFIED";
    ctx.provider.nextRawStatus = "completed";
    const result = await ctx.refresh.execute(verification.id);

    expect(result.changed).toBe(true);
    expect(result.verification.status).toBe("RESUBMISSION_REQUIRED");
    expect(result.verification.resubmissionReason).toMatch(/business registration/i);
    // Never a payout-eligible/marketplace-visible APPROVED state.
    expect(result.verification.status).not.toBe("APPROVED");

    const profile = await ctx.professionals.findByUserId("user-1");
    expect(profile?.verificationStatus).not.toBe("VERIFIED");
    expect(profile?.verificationStatus).toBe("PENDING");
    expect(ctx.auditLog.actions()).toContain("VERIFICATION_RESUBMISSION_REQUESTED");
    expect(ctx.auditLog.actions()).not.toContain("VERIFICATION_APPROVED");
    expect(ctx.notifications.events.some((e) => e.type === "VERIFICATION_RESUBMISSION_REQUIRED")).toBe(true);

    // A subsequent refresh (e.g. after the professional uploads the
    // document and Persona is checked again) is still possible: the case
    // is not stuck, because RESUBMISSION_REQUIRED remains a syncable state
    // once the professional resubmits it back to PENDING/UNDER_REVIEW.
    expect(ctx.provider.refreshCalls).toHaveLength(1);
  });

  it("Module 98: after RESUBMISSION_REQUIRED for a missing business document, uploading the document and resubmitting allows a later refresh to reach APPROVED", async () => {
    activeProfessional(ctx);
    const { verification } = await ctx.start.execute({ userId: "user-1", fullName: "Ana García", countryCode: "ES" });

    ctx.provider.nextOutcome = "VERIFIED";
    const first = await ctx.refresh.execute(verification.id);
    expect(first.verification.status).toBe("RESUBMISSION_REQUIRED");

    // Professional uploads the missing document and resubmits — case moves
    // back to PENDING (canResubmit/canModifyDocuments already allow this
    // from RESUBMISSION_REQUIRED; this test only re-confirms the refresh
    // path converges once the document is present).
    await addBusinessRegistrationDocument(ctx, verification.id);
    await ctx.verifications.updateStatus(verification.id, { status: "PENDING" });

    const second = await ctx.refresh.execute(verification.id);
    expect(second.verification.status).toBe("APPROVED");
    const profile = await ctx.professionals.findByUserId("user-1");
    expect(profile?.verificationStatus).toBe("VERIFIED");
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
    await addBusinessRegistrationDocument(ctx, verification.id);

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

  it("blocks payouts while PENDING and allows them once APPROVED with a business-registration document", async () => {
    const ctx = makeContext();
    activeProfessional(ctx);
    const { verification } = await ctx.start.execute({ userId: "user-1", fullName: "Ana García", countryCode: "ES" });
    await addBusinessRegistrationDocument(ctx, verification.id);
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

  // Module 98 — Professional Tax & Business Verification.
  it("Module 98: never grants payout eligibility from Persona identity verification alone", async () => {
    const ctx = makeContext();
    activeProfessional(ctx);
    const { verification } = await ctx.start.execute({ userId: "user-1", fullName: "Ana García", countryCode: "ES" });
    const professional = (await ctx.professionals.findByUserId("user-1"))!;

    ctx.provider.nextOutcome = "VERIFIED";
    await ctx.refresh.execute(verification.id);

    const eligibility = await ctx.payoutEligibility.execute(professional.id);
    expect(eligibility.eligible).toBe(false);
    expect(eligibility.status).not.toBe("APPROVED");
  });
});

// ============================================================================
// Module 114 — Fix Persona Business Verification Bypass
// ============================================================================
//
// Phase 2 of Module 114 reproduced the exact scenario the module brief
// describes (Persona reports success + identity is valid + business
// verification is missing -> professional becomes VERIFIED) against the
// CURRENT code and found it already closed by Module 98 (see the two
// "Module 98" tests above, and
// MaestroYa_Module_114_Persona_Business_Verification_Fix_Report.md for the
// full reproduction). No production code changed for Module 114 — these
// tests pin down, in the module's own three-component vocabulary, that the
// invariant holds:
//
//   Identity verification + Selfie/Photo verification + Business
//   verification (Autónomo or S.L.) = VERIFIED
//
// Architectural note (see the report for the full analysis): Persona's
// hosted inquiry flow performs the identity-document check and the
// selfie/liveness match together, as one step, before it ever reports an
// outcome back to this platform — see verification-provider.ts's own doc
// comment ("complete the identity/selfie/liveness checks") and
// persona-verification-provider.ts's data-minimization note that "selfie
// images live only in Persona's own systems". `VerificationStatusResult`
// carries exactly one `ProviderVerificationOutcome` per inquiry — there is
// no separate "identity approved, selfie not yet approved" signal Persona
// can report, by construction of this integration and Persona's own
// Inquiry API. So for the Persona/automated path,
// `ProviderVerificationOutcome === "VERIFIED"` already *is* "Identity +
// Selfie/Photo approved" — the tests below exercise the realizable
// combinations (provider verified vs. not, business document present vs.
// not) rather than a decomposition the current architecture has no way to
// produce. The manual (non-Persona) path's equivalent coverage already
// lives in verification-flows.test.ts ("refuses to approve a case with no
// business-registration document", "start review → approve verifies the
// professional...").
describe("Module 114 — three-component verification invariant (Identity + Selfie/Photo + Business)", () => {
  let ctx: ReturnType<typeof makeContext>;
  beforeEach(() => {
    ctx = makeContext();
  });

  it("Identity+Selfie approved (Persona VERIFIED) + Business approved -> professional becomes VERIFIED", async () => {
    activeProfessional(ctx);
    const { verification } = await ctx.start.execute({ userId: "user-1", fullName: "Ana García", countryCode: "ES" });
    await addBusinessRegistrationDocument(ctx, verification.id);

    ctx.provider.nextOutcome = "VERIFIED";
    const result = await ctx.refresh.execute(verification.id);

    expect(result.verification.status).toBe("APPROVED");
    expect((await ctx.professionals.findByUserId("user-1"))?.verificationStatus).toBe("VERIFIED");
  });

  it("Identity+Selfie approved (Persona VERIFIED) + Business missing -> professional does NOT become VERIFIED", async () => {
    activeProfessional(ctx);
    const { verification } = await ctx.start.execute({ userId: "user-1", fullName: "Ana García", countryCode: "ES" });

    ctx.provider.nextOutcome = "VERIFIED";
    const result = await ctx.refresh.execute(verification.id);

    expect(result.verification.status).not.toBe("APPROVED");
    expect((await ctx.professionals.findByUserId("user-1"))?.verificationStatus).not.toBe("VERIFIED");
  });

  it("Business approved alone, with Persona not yet reporting VERIFIED (identity/selfie still pending) -> professional does NOT become VERIFIED", async () => {
    activeProfessional(ctx);
    const { verification } = await ctx.start.execute({ userId: "user-1", fullName: "Ana García", countryCode: "ES" });
    await addBusinessRegistrationDocument(ctx, verification.id);

    // A business document being present must never, by itself, grant
    // VERIFIED while identity+selfie has not yet been confirmed.
    ctx.provider.nextOutcome = "PENDING";
    const result = await ctx.refresh.execute(verification.id);

    expect(result.verification.status).toBe("PENDING");
    expect((await ctx.professionals.findByUserId("user-1"))?.verificationStatus).not.toBe("VERIFIED");
  });

  it("Identity/Selfie rejected by Persona + Business approved -> professional does NOT become VERIFIED", async () => {
    activeProfessional(ctx);
    const { verification } = await ctx.start.execute({ userId: "user-1", fullName: "Ana García", countryCode: "ES" });
    await addBusinessRegistrationDocument(ctx, verification.id);

    ctx.provider.nextOutcome = "REJECTED";
    const result = await ctx.refresh.execute(verification.id);

    expect(result.verification.status).toBe("REJECTED");
    expect((await ctx.professionals.findByUserId("user-1"))?.verificationStatus).toBe("REJECTED");
  });

  it("repeated Persona refresh calls on an already-APPROVED case are idempotent and never re-derive eligibility from a stale/duplicate observation", async () => {
    activeProfessional(ctx);
    const { verification } = await ctx.start.execute({ userId: "user-1", fullName: "Ana García", countryCode: "ES" });
    await addBusinessRegistrationDocument(ctx, verification.id);

    ctx.provider.nextOutcome = "VERIFIED";
    const first = await ctx.refresh.execute(verification.id);
    expect(first.changed).toBe(true);
    expect(first.verification.status).toBe("APPROVED");

    // A second refresh call (e.g. a duplicate cron tick, or a professional
    // re-clicking "check status") observes the same VERIFIED outcome
    // again. canSyncProviderStatus(APPROVED) is false, so this is a pure
    // no-op — it must not re-run the business-document check, re-notify,
    // or otherwise change state.
    const notificationsBefore = ctx.notifications.events.length;
    const second = await ctx.refresh.execute(verification.id);
    expect(second.changed).toBe(false);
    expect(second.verification.status).toBe("APPROVED");
    expect(ctx.notifications.events.length).toBe(notificationsBefore);
  });
});
