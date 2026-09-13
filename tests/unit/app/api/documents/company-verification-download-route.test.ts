import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { NotFoundError, UnauthorizedError } from "@/domain/errors/domain-error";

/**
 * Module 106 — Secure Cloudinary Document Delivery.
 *
 * Company-side mirror of verification-download-route.test.ts — see that
 * file's own doc comment for the shared mocking convention. Covers the
 * same required scenarios for `/api/documents/company-verification/[documentId]`,
 * plus the company-specific cross-company (Threat 3) and insufficient-
 * role (MANAGER/MEMBER) denials.
 */
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

const { mockUsers } = vi.hoisted(() => ({
  mockUsers: { findById: vi.fn(), getRoleKeys: vi.fn() },
}));
vi.mock("@/infrastructure/database/prisma/repositories/prisma-user-repository", () => ({
  PrismaUserRepository: vi.fn().mockImplementation(() => mockUsers),
}));

const mockExecute = vi.fn();
vi.mock("@/application/use-cases/company-verification/compose", () => ({
  makeGetCompanyVerificationDocumentUseCase: () => ({ execute: mockExecute }),
}));

const mockFetchDocument = vi.fn();
import type * as PrivateDocumentDeliveryModule from "@/infrastructure/storage/cloudinary/private-document-delivery-service";

vi.mock("@/infrastructure/storage/cloudinary/private-document-delivery-service", async () => {
  const actual = await vi.importActual<typeof PrivateDocumentDeliveryModule>(
    "@/infrastructure/storage/cloudinary/private-document-delivery-service",
  );
  return {
    ...actual,
    CloudinaryPrivateDocumentDeliveryService: vi.fn().mockImplementation(() => ({
      fetchDocument: mockFetchDocument,
    })),
  };
});

const { auth } = await import("@/lib/auth");
const { GET } = await import("../../../../../src/app/api/documents/company-verification/[documentId]/route");

const mockedAuth = vi.mocked(auth);

function makeRequest(documentId: string) {
  const request = new NextRequest(`http://localhost:3000/api/documents/company-verification/${documentId}`);
  return { request, context: { params: Promise.resolve({ documentId }) } };
}

const SAMPLE_DOCUMENT = {
  id: "cdoc-1",
  verificationId: "cv-1",
  fileUrl: "https://res.cloudinary.com/demo/image/private/s--sig--/v1/maestroya/company-verifications/cv-1/cdoc-1.png",
  originalFilename: "business-license.png",
  mimeType: "image/png",
  fileSizeBytes: 4,
};

describe("GET /api/documents/company-verification/[documentId]", () => {
  beforeEach(() => {
    mockedAuth.mockReset();
    mockUsers.findById.mockReset();
    mockUsers.getRoleKeys.mockReset();
    mockExecute.mockReset();
    mockFetchDocument.mockReset();
    mockFetchDocument.mockResolvedValue({ body: Buffer.from("PNGDATA") });
  });

  it("denies an unauthenticated request (401) and never calls the use case", async () => {
    mockedAuth.mockResolvedValue(null as never);

    const { request, context } = makeRequest("cdoc-1");
    const response = await GET(request, context);

    expect(response.status).toBe(401);
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it("lets a company OWNER download the company's document (200, no Cloudinary URL leaked)", async () => {
    mockedAuth.mockResolvedValue({
      user: { id: "owner-1", email: "owner@example.com", roles: ["PROVIDER"], signupIntent: null },
    } as never);
    mockExecute.mockResolvedValue(SAMPLE_DOCUMENT);

    const { request, context } = makeRequest("cdoc-1");
    const response = await GET(request, context);
    const bodyText = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/png");
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(JSON.stringify(Object.fromEntries(response.headers.entries()))).not.toContain("cloudinary.com");
    expect(bodyText).not.toContain("cloudinary.com");
    expect(mockExecute).toHaveBeenCalledWith({ userId: "owner-1", isAdmin: false }, "cdoc-1");
  });

  it("denies a member of a different company (Threat 3 — cross-company access)", async () => {
    mockedAuth.mockResolvedValue({
      user: { id: "other-company-user", email: "x@example.com", roles: ["PROVIDER"], signupIntent: null },
    } as never);
    mockExecute.mockRejectedValue(new NotFoundError("CompanyVerificationDocument", "cdoc-1"));

    const { request, context } = makeRequest("cdoc-1");
    const response = await GET(request, context);

    expect(response.status).toBe(404);
    expect(mockFetchDocument).not.toHaveBeenCalled();
  });

  it("denies a same-company MANAGER/MEMBER lacking canManageCompanyProfile", async () => {
    mockedAuth.mockResolvedValue({
      user: { id: "manager-1", email: "m@example.com", roles: ["PROVIDER"], signupIntent: null },
    } as never);
    mockExecute.mockRejectedValue(new UnauthorizedError("Only a company owner or admin may view verification documents."));

    const { request, context } = makeRequest("cdoc-1");
    const response = await GET(request, context);

    expect(response.status).toBe(401);
  });

  it("allows a platform ADMIN regardless of company membership", async () => {
    mockedAuth.mockResolvedValue({
      user: { id: "admin-1", email: "admin@example.com", roles: ["SUPER_ADMIN"], signupIntent: null },
    } as never);
    mockUsers.findById.mockResolvedValue({ id: "admin-1", status: "ACTIVE" });
    mockUsers.getRoleKeys.mockResolvedValue(["SUPER_ADMIN"]);
    mockExecute.mockResolvedValue(SAMPLE_DOCUMENT);

    const { request, context } = makeRequest("cdoc-1");
    const response = await GET(request, context);

    expect(response.status).toBe(200);
    expect(mockExecute).toHaveBeenCalledWith({ userId: "admin-1", isAdmin: true }, "cdoc-1");
  });

  it("fails safely (404) for a nonexistent document id", async () => {
    mockedAuth.mockResolvedValue({
      user: { id: "owner-1", email: "owner@example.com", roles: ["PROVIDER"], signupIntent: null },
    } as never);
    mockExecute.mockRejectedValue(new NotFoundError("CompanyVerificationDocument", "missing"));

    const { request, context } = makeRequest("missing");
    const response = await GET(request, context);

    expect(response.status).toBe(404);
  });
});
