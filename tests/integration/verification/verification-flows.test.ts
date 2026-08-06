import { beforeEach, describe, expect, it } from "vitest";

import { ApproveProfessionalVerificationUseCase } from "@/application/use-cases/verification/approve-professional-verification.use-case";
import { CreateProfessionalVerificationUseCase } from "@/application/use-cases/verification/create-professional-verification.use-case";
import { GetAdminVerificationUseCase } from "@/application/use-cases/verification/get-admin-verification.use-case";
import { GetProfessionalVerificationUseCase } from "@/application/use-cases/verification/get-professional-verification.use-case";
import { ListAdminVerificationsUseCase } from "@/application/use-cases/verification/list-admin-verifications.use-case";
import { RecordProfessionalVerificationAuditLogSubscriber } from "@/application/use-cases/verification/record-professional-verification-audit-log.subscriber";
import { NotifyProfessionalVerificationStatusChangeSubscriber } from "@/application/use-cases/notification/notify-professional-verification-status-change.subscriber";
import { RejectProfessionalVerificationUseCase } from "@/application/use-cases/verification/reject-professional-verification.use-case";
import { RemoveVerificationDocumentUseCase } from "@/application/use-cases/verification/remove-verification-document.use-case";
import { RequestVerificationResubmissionUseCase } from "@/application/use-cases/verification/request-verification-resubmission.use-case";
import { ResubmitProfessionalVerificationUseCase } from "@/application/use-cases/verification/resubmit-professional-verification.use-case";
import { StartVerificationReviewUseCase } from "@/application/use-cases/verification/start-verification-review.use-case";
import { SubmitProfessionalVerificationUseCase } from "@/application/use-cases/verification/submit-professional-verification.use-case";
import { UploadVerificationDocumentUseCase } from "@/application/use-cases/verification/upload-verification-document.use-case";
import { ProfessionalVerificationStatusChanged } from "@/domain/events/professional-verification-status-changed";
import { ConflictError, NotFoundError, ValidationError } from "@/domain/errors/domain-error";
import { SynchronousEventBus } from "@/infrastructure/events/synchronous-event-bus";
import {
  FakeAdminAuditLogRepository,
  FakeNotificationCreator,
  FakeProfessionalRepository,
  FakeProfessionalVerificationRepository,
  FakeVerificationDocumentUploadService,
} from "./fakes";

/**
 * Integration tests for the Professional Verification module (Module 17).
 * Real use cases + domain rules, fake repositories/services swapped in for
 * storage — same pattern as portfolio-flows.test.ts / admin-flows.test.ts.
 */
function makeContext() {
  const professionals = new FakeProfessionalRepository();
  const verifications = new FakeProfessionalVerificationRepository(professionals);
  const auditLog = new FakeAdminAuditLogRepository();
  const notifications = new FakeNotificationCreator();
  const uploads = new FakeVerificationDocumentUploadService();

  // Module 37 — Domain Event Subscribers: submit/resubmit/approve/reject/
  // request-resubmission publish `ProfessionalVerificationStatusChanged`
  // instead of calling `auditLog`/`notifications` directly — wire a real
  // `SynchronousEventBus` with the real subscribers so this integration
  // test still exercises the full, genuine side-effect path end to end,
  // same pattern as tests/integration/admin/company-status-change-events.test.ts.
  const eventBus = new SynchronousEventBus();
  eventBus.subscribe(
    ProfessionalVerificationStatusChanged,
    new RecordProfessionalVerificationAuditLogSubscriber(auditLog),
  );
  eventBus.subscribe(
    ProfessionalVerificationStatusChanged,
    new NotifyProfessionalVerificationStatusChangeSubscriber(notifications),
  );

  return {
    professionals,
    verifications,
    auditLog,
    notifications,
    uploads,
    get: new GetProfessionalVerificationUseCase(verifications, professionals),
    create: new CreateProfessionalVerificationUseCase(verifications, professionals),
    upload: new UploadVerificationDocumentUseCase(verifications, professionals, uploads, auditLog),
    remove: new RemoveVerificationDocumentUseCase(verifications, professionals, auditLog),
    submit: new SubmitProfessionalVerificationUseCase(verifications, professionals, eventBus),
    resubmit: new ResubmitProfessionalVerificationUseCase(verifications, professionals, eventBus),
    list: new ListAdminVerificationsUseCase(verifications),
    getAdmin: new GetAdminVerificationUseCase(verifications),
    startReview: new StartVerificationReviewUseCase(verifications, auditLog),
    approve: new ApproveProfessionalVerificationUseCase(verifications, professionals, eventBus),
    reject: new RejectProfessionalVerificationUseCase(verifications, professionals, eventBus),
    requestResubmission: new RequestVerificationResubmissionUseCase(verifications, professionals, eventBus),
  };
}

const IDENTITY_DOC = {
  type: "NATIONAL_ID" as const,
  fileBuffer: Buffer.from("fake"),
  contentType: "image/png",
  originalFilename: "id.png",
  fileSizeBytes: 100,
};

async function seedSubmittedCase(ctx: ReturnType<typeof makeContext>, userId = "user-pro-1") {
  const professional = ctx.professionals.seed({ userId, status: "ACTIVE", businessName: "Bob Plumbing" });
  await ctx.create.execute(userId);
  await ctx.upload.execute(userId, IDENTITY_DOC);
  const verification = await ctx.submit.execute(userId);
  return { professional, verification };
}

describe("Professional Verification module (Module 17)", () => {
  let ctx: ReturnType<typeof makeContext>;
  beforeEach(() => {
    ctx = makeContext();
  });

  describe("full professional flow", () => {
    it("create → upload → submit sets PENDING, audits, notifies, flips the public signal", async () => {
      const { professional, verification } = await seedSubmittedCase(ctx);

      expect(verification.status).toBe("PENDING");
      expect(verification.submittedAt).not.toBeNull();
      expect(ctx.professionals.profiles.get(professional.id)?.verificationStatus).toBe("PENDING");
      expect(ctx.auditLog.actions()).toContain("VERIFICATION_DOCUMENT_UPLOADED");
      expect(ctx.auditLog.actions()).toContain("VERIFICATION_SUBMITTED");
      expect(ctx.notifications.events.map((e) => e.type)).toContain("VERIFICATION_SUBMITTED");
      // The stored document URL is never logged.
      const uploadEntry = ctx.auditLog.entries.find((e) => e.action === "VERIFICATION_DOCUMENT_UPLOADED");
      expect(JSON.stringify(uploadEntry?.metadata ?? {})).not.toContain("cloudinary");
    });

    it("rejects submission without an identity document", async () => {
      const userId = "user-pro-2";
      ctx.professionals.seed({ userId, status: "ACTIVE" });
      await ctx.create.execute(userId);
      await ctx.upload.execute(userId, { ...IDENTITY_DOC, type: "INSURANCE_CERTIFICATE" });
      await expect(ctx.submit.execute(userId)).rejects.toBeInstanceOf(ValidationError);
    });

    it("requires an active professional profile to create a case", async () => {
      ctx.professionals.seed({ userId: "user-suspended", status: "SUSPENDED" });
      await expect(ctx.create.execute("user-suspended")).rejects.toBeInstanceOf(ValidationError);
      await expect(ctx.create.execute("user-nobody")).rejects.toBeInstanceOf(ValidationError);
    });
  });

  describe("duplicate active verification prevention & already-approved edge case", () => {
    it("prevents opening a second active case", async () => {
      const userId = "user-pro-3";
      ctx.professionals.seed({ userId, status: "ACTIVE" });
      await ctx.create.execute(userId);
      await expect(ctx.create.execute(userId)).rejects.toBeInstanceOf(ConflictError);
    });

    it("does not let an already-approved professional open a new case", async () => {
      const { professional, verification } = await seedSubmittedCase(ctx, "user-pro-4");
      await ctx.approve.execute("admin-1", verification.id);
      expect(ctx.professionals.profiles.get(professional.id)?.verificationStatus).toBe("VERIFIED");
      await expect(ctx.create.execute("user-pro-4")).rejects.toBeInstanceOf(ConflictError);
    });
  });

  describe("document access control", () => {
    it("denies professional B removing professional A's document", async () => {
      const userA = "user-a";
      ctx.professionals.seed({ userId: userA, status: "ACTIVE" });
      await ctx.create.execute(userA);
      const doc = await ctx.upload.execute(userA, IDENTITY_DOC);

      ctx.professionals.seed({ userId: "user-b", status: "ACTIVE" });
      await ctx.create.execute("user-b");

      await expect(ctx.remove.execute("user-b", doc.id)).rejects.toBeInstanceOf(NotFoundError);
      // The document is still there for its real owner.
      expect(await ctx.verifications.findDocumentById(doc.id)).not.toBeNull();
    });

    it("freezes the document set once submitted (no upload/remove while PENDING)", async () => {
      const userId = "user-pro-5";
      ctx.professionals.seed({ userId, status: "ACTIVE" });
      await ctx.create.execute(userId);
      const doc = await ctx.upload.execute(userId, IDENTITY_DOC);
      await ctx.submit.execute(userId);

      await expect(ctx.upload.execute(userId, IDENTITY_DOC)).rejects.toBeInstanceOf(ConflictError);
      await expect(ctx.remove.execute(userId, doc.id)).rejects.toBeInstanceOf(ConflictError);
    });
  });

  describe("admin review", () => {
    it("lists, filters and fetches detail with documents", async () => {
      await seedSubmittedCase(ctx, "user-pro-6");
      const all = await ctx.list.execute({ limit: 20, offset: 0 });
      expect(all).toHaveLength(1);
      const pendingOnly = await ctx.list.execute({ limit: 20, offset: 0, status: "PENDING" });
      expect(pendingOnly).toHaveLength(1);
      const approvedOnly = await ctx.list.execute({ limit: 20, offset: 0, status: "APPROVED" });
      expect(approvedOnly).toHaveLength(0);

      const detail = await ctx.getAdmin.execute(all[0]!.id);
      expect(detail.documents).toHaveLength(1);
      expect(detail.professionalUserId).toBe("user-pro-6");
    });

    it("start review → approve verifies the professional, audits and notifies", async () => {
      const { professional, verification } = await seedSubmittedCase(ctx, "user-pro-7");
      const underReview = await ctx.startReview.execute("admin-1", verification.id);
      expect(underReview.status).toBe("UNDER_REVIEW");
      expect(underReview.reviewedByUserId).toBe("admin-1");

      const approved = await ctx.approve.execute("admin-1", verification.id);
      expect(approved.status).toBe("APPROVED");
      expect(approved.expiresAt).not.toBeNull();
      expect(ctx.professionals.profiles.get(professional.id)?.verificationStatus).toBe("VERIFIED");
      expect(ctx.professionals.profiles.get(professional.id)?.verifiedAt).not.toBeNull();
      expect(ctx.auditLog.actions()).toContain("VERIFICATION_REVIEW_STARTED");
      expect(ctx.auditLog.actions()).toContain("VERIFICATION_APPROVED");
      const approvedNote = ctx.notifications.events.find((e) => e.type === "VERIFICATION_APPROVED");
      expect(approvedNote?.userId).toBe("user-pro-7");
    });

    it("reject requires a reason and stores it; without a valid reason it throws", async () => {
      const { professional, verification } = await seedSubmittedCase(ctx, "user-pro-8");
      await expect(ctx.reject.execute("admin-1", verification.id, "short")).rejects.toBeInstanceOf(ValidationError);

      const rejected = await ctx.reject.execute("admin-1", verification.id, "Your ID photo was unreadable.");
      expect(rejected.status).toBe("REJECTED");
      expect(rejected.rejectionReason).toBe("Your ID photo was unreadable.");
      expect(ctx.professionals.profiles.get(professional.id)?.verificationStatus).toBe("REJECTED");
      expect(ctx.notifications.events.map((e) => e.type)).toContain("VERIFICATION_REJECTED");
    });

    it("request resubmission requires a reason, keeps the public signal PENDING, and re-opens edits", async () => {
      const { professional, verification } = await seedSubmittedCase(ctx, "user-pro-9");
      await expect(ctx.requestResubmission.execute("admin-1", verification.id, "")).rejects.toBeInstanceOf(
        ValidationError,
      );

      const asked = await ctx.requestResubmission.execute("admin-1", verification.id, "Please add proof of address.");
      expect(asked.status).toBe("RESUBMISSION_REQUIRED");
      expect(asked.resubmissionReason).toBe("Please add proof of address.");
      expect(ctx.professionals.profiles.get(professional.id)?.verificationStatus).toBe("PENDING");
      expect(ctx.notifications.events.map((e) => e.type)).toContain("VERIFICATION_RESUBMISSION_REQUIRED");

      // Documents can be edited again, then resubmitted → back to PENDING.
      await ctx.upload.execute("user-pro-9", { ...IDENTITY_DOC, type: "PROOF_OF_ADDRESS" });
      const resubmitted = await ctx.resubmit.execute("user-pro-9");
      expect(resubmitted.status).toBe("PENDING");
      expect(resubmitted.resubmissionReason).toBeNull();
    });

    it("cannot approve a case that is not in a decidable state", async () => {
      const { verification } = await seedSubmittedCase(ctx, "user-pro-10");
      await ctx.reject.execute("admin-1", verification.id, "Not enough documentation provided.");
      await expect(ctx.approve.execute("admin-1", verification.id)).rejects.toBeInstanceOf(ConflictError);
    });

    it("allows resubmission after a rejection (REJECTED → PENDING)", async () => {
      const { verification } = await seedSubmittedCase(ctx, "user-pro-11");
      await ctx.reject.execute("admin-1", verification.id, "Documents did not match the profile name.");
      const resubmitted = await ctx.resubmit.execute("user-pro-11");
      expect(resubmitted.status).toBe("PENDING");
      expect(ctx.auditLog.actions()).toContain("VERIFICATION_RESUBMITTED");
    });
  });

  describe("professional read view", () => {
    it("reports no profile / no case cleanly", async () => {
      const noProfile = await ctx.get.execute("ghost");
      expect(noProfile.hasProfessionalProfile).toBe(false);

      ctx.professionals.seed({ userId: "user-pro-12", status: "ACTIVE" });
      const started = await ctx.get.execute("user-pro-12");
      expect(started.hasProfessionalProfile).toBe(true);
      expect(started.verification).toBeNull();
    });
  });
});
