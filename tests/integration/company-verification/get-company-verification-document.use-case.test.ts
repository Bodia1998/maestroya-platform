import { beforeEach, describe, expect, it } from "vitest";

import { GetCompanyVerificationDocumentUseCase } from "@/application/use-cases/company-verification/get-company-verification-document.use-case";
import { NotFoundError, UnauthorizedError } from "@/domain/errors/domain-error";
import { FakeCompanyMembershipRepository } from "../company/fakes";
import { FakeCompanyVerificationRepository } from "./fakes";

/**
 * Module 106 — Secure Cloudinary Document Delivery.
 *
 * Security regression coverage for the authorization gate behind
 * `/api/documents/company-verification/[documentId]`. Reuses
 * `FakeCompanyMembershipRepository` from the existing Module 18 fakes
 * (tests/integration/company/fakes.ts) plus a new
 * `FakeCompanyVerificationRepository` (this module — see ./fakes.ts).
 * Covers: owner/admin company-member access, a MANAGER/MEMBER denial
 * (mirrors GetCompanyVerificationUseCase's own restriction), cross-
 * company denial (Threat 3), platform-admin access, and safe denial for
 * a nonexistent document.
 */
function makeContext() {
  const memberships = new FakeCompanyMembershipRepository();
  const verifications = new FakeCompanyVerificationRepository();
  return { memberships, verifications, useCase: new GetCompanyVerificationDocumentUseCase(verifications, memberships) };
}

function seedCase(ctx: ReturnType<typeof makeContext>, companyId: string) {
  const verification = ctx.verifications.seedVerification({ id: "cv-1", companyProfileId: companyId });
  const document = ctx.verifications.seedDocument({ id: "cdoc-1", verificationId: verification.id });
  return { verification, document };
}

describe("GetCompanyVerificationDocumentUseCase (Module 106 — download-proxy authorization)", () => {
  let ctx: ReturnType<typeof makeContext>;

  beforeEach(() => {
    ctx = makeContext();
  });

  it("lets the company OWNER download the company's verification document", async () => {
    seedCase(ctx, "company-1");
    ctx.memberships.seed({ companyId: "company-1", userId: "owner-user", role: "OWNER" });

    const document = await ctx.useCase.execute({ userId: "owner-user", isAdmin: false }, "cdoc-1");

    expect(document.id).toBe("cdoc-1");
  });

  it("lets a company ADMIN member download the document", async () => {
    seedCase(ctx, "company-1");
    ctx.memberships.seed({ companyId: "company-1", userId: "admin-member", role: "ADMIN" });

    const document = await ctx.useCase.execute({ userId: "admin-member", isAdmin: false }, "cdoc-1");

    expect(document.id).toBe("cdoc-1");
  });

  it("denies a MANAGER company member (same company, insufficient role)", async () => {
    seedCase(ctx, "company-1");
    ctx.memberships.seed({ companyId: "company-1", userId: "manager-user", role: "MANAGER" });

    await expect(ctx.useCase.execute({ userId: "manager-user", isAdmin: false }, "cdoc-1")).rejects.toThrow(
      UnauthorizedError,
    );
  });

  it("denies a plain MEMBER company member", async () => {
    seedCase(ctx, "company-1");
    ctx.memberships.seed({ companyId: "company-1", userId: "member-user", role: "MEMBER" });

    await expect(ctx.useCase.execute({ userId: "member-user", isAdmin: false }, "cdoc-1")).rejects.toThrow(
      UnauthorizedError,
    );
  });

  it("denies a member of a different company (Threat 3 — cross-company access)", async () => {
    seedCase(ctx, "company-1");
    ctx.memberships.seed({ companyId: "company-2", userId: "other-company-owner", role: "OWNER" });

    await expect(
      ctx.useCase.execute({ userId: "other-company-owner", isAdmin: false }, "cdoc-1"),
    ).rejects.toThrow(NotFoundError);
  });

  it("denies a user with no membership at all", async () => {
    seedCase(ctx, "company-1");

    await expect(ctx.useCase.execute({ userId: "stranger", isAdmin: false }, "cdoc-1")).rejects.toThrow(
      NotFoundError,
    );
  });

  it("lets a platform admin download any company's document regardless of membership", async () => {
    seedCase(ctx, "company-1");

    const document = await ctx.useCase.execute({ userId: "platform-admin", isAdmin: true }, "cdoc-1");

    expect(document.id).toBe("cdoc-1");
  });

  it("fails safely (NotFoundError) for a nonexistent document id", async () => {
    await expect(ctx.useCase.execute({ userId: "owner-user", isAdmin: false }, "missing")).rejects.toThrow(
      NotFoundError,
    );
    await expect(ctx.useCase.execute({ userId: "platform-admin", isAdmin: true }, "missing")).rejects.toThrow(
      NotFoundError,
    );
  });
});
