import { beforeEach, describe, expect, it } from "vitest";

import { GetVerificationDocumentUseCase } from "@/application/use-cases/verification/get-verification-document.use-case";
import { NotFoundError, UnauthorizedError } from "@/domain/errors/domain-error";
import { FakeProfessionalRepository, FakeProfessionalVerificationRepository } from "./fakes";

/**
 * Module 106 — Secure Cloudinary Document Delivery.
 *
 * Security regression coverage for the authorization gate behind
 * `/api/documents/verification/[documentId]` — the professional
 * verification document download proxy. Real use case, fake repositories
 * (same convention as verification-flows.test.ts), covering the module's
 * required scenarios: owner access, cross-user denial, admin access, a
 * soft-deleted (GDPR-erased) document, and a nonexistent document id.
 */
function makeContext() {
  const professionals = new FakeProfessionalRepository();
  const verifications = new FakeProfessionalVerificationRepository(professionals);
  return { professionals, verifications, useCase: new GetVerificationDocumentUseCase(verifications, professionals) };
}

function seedCase(ctx: ReturnType<typeof makeContext>, ownerUserId: string) {
  const profile = ctx.professionals.seed({ userId: ownerUserId });
  ctx.verifications.verifications.set("v-1", {
    id: "v-1",
    professionalProfileId: profile.id,
    status: "PENDING",
    submittedAt: new Date(),
    reviewedAt: null,
    reviewedByUserId: null,
    rejectionReason: null,
    resubmissionReason: null,
    expiresAt: null,
    provider: "MANUAL",
    providerVerificationId: null,
    providerStatus: null,
    providerSyncedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  ctx.verifications.documents.set("doc-1", {
    id: "doc-1",
    verificationId: "v-1",
    type: "NATIONAL_ID",
    status: "PENDING",
    fileUrl: "https://res.cloudinary.com/demo/image/private/v1/maestroya/verifications/v-1/doc-1.png",
    originalFilename: "id.png",
    mimeType: "image/png",
    fileSizeBytes: 100,
    rejectionReason: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    storagePurgedAt: null,
    storagePurgeStatus: "PENDING",
    storagePurgeAttemptCount: 0,
    storagePurgeNextAttemptAt: null,
    storagePurgeLastError: null,
    storagePurgeLastAttemptedAt: null,
  });
  return { profile };
}

describe("GetVerificationDocumentUseCase (Module 106 — download-proxy authorization)", () => {
  let ctx: ReturnType<typeof makeContext>;

  beforeEach(() => {
    ctx = makeContext();
  });

  it("lets the owning professional download their own document", async () => {
    seedCase(ctx, "user-owner");

    const document = await ctx.useCase.execute({ userId: "user-owner", isAdmin: false }, "doc-1");

    expect(document.id).toBe("doc-1");
    expect(document.fileUrl).toContain("res.cloudinary.com");
  });

  it("denies a different authenticated user (User A cannot access User B's document — IDOR)", async () => {
    seedCase(ctx, "user-owner");

    await expect(ctx.useCase.execute({ userId: "user-attacker", isAdmin: false }, "doc-1")).rejects.toThrow(
      UnauthorizedError,
    );
  });

  it("denies an unauthenticated caller with no professional profile at all", async () => {
    seedCase(ctx, "user-owner");

    await expect(ctx.useCase.execute({ userId: "user-with-no-profile", isAdmin: false }, "doc-1")).rejects.toThrow(
      UnauthorizedError,
    );
  });

  it("lets an admin download any document regardless of ownership", async () => {
    seedCase(ctx, "user-owner");

    const document = await ctx.useCase.execute({ userId: "admin-1", isAdmin: true }, "doc-1");

    expect(document.id).toBe("doc-1");
  });

  it("fails safely (NotFoundError) for a nonexistent document id", async () => {
    await expect(ctx.useCase.execute({ userId: "user-owner", isAdmin: false }, "doc-missing")).rejects.toThrow(
      NotFoundError,
    );
    await expect(ctx.useCase.execute({ userId: "admin-1", isAdmin: true }, "doc-missing")).rejects.toThrow(
      NotFoundError,
    );
  });

  it("never re-serves a GDPR-erased (soft-deleted) document, even to an admin", async () => {
    seedCase(ctx, "user-owner");
    const existing = ctx.verifications.documents.get("doc-1")!;
    ctx.verifications.documents.set("doc-1", { ...existing, deletedAt: new Date() });

    await expect(ctx.useCase.execute({ userId: "user-owner", isAdmin: false }, "doc-1")).rejects.toThrow(
      NotFoundError,
    );
    await expect(ctx.useCase.execute({ userId: "admin-1", isAdmin: true }, "doc-1")).rejects.toThrow(NotFoundError);
  });

  it("a professional with a profile but no verification case for this document is still denied", async () => {
    seedCase(ctx, "user-owner");
    ctx.professionals.seed({ userId: "user-other-pro" });

    await expect(ctx.useCase.execute({ userId: "user-other-pro", isAdmin: false }, "doc-1")).rejects.toThrow(
      UnauthorizedError,
    );
  });
});
