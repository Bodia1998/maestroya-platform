import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { NotFoundError, UnauthorizedError } from "@/domain/errors/domain-error";

/**
 * Module 106 — Secure Cloudinary Document Delivery.
 *
 * HTTP-level security-boundary test for
 * `GET /api/documents/verification/[documentId]` — the new authenticated
 * proxy that replaced the raw `doc.fileUrl` link on the admin
 * verification-detail page. Same mocking convention as
 * circuit-breakers-route.test.ts / diagnostics-route.test.ts: mock
 * `@/lib/auth`'s `auth()` and `PrismaUserRepository` (requireRole's
 * admin-freshness re-check), mock the use-case/delivery-service
 * collaborators, then invoke the real route with a real `NextRequest`.
 *
 * Covers the module's required HTTP-layer regression scenarios:
 * unauthenticated denial, cross-user denial, owner success, admin
 * success, a nonexistent document, and proof that the response never
 * carries the underlying Cloudinary URL or any Cloudinary credential.
 */
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

const { mockUsers } = vi.hoisted(() => ({
  mockUsers: { findById: vi.fn(), getRoleKeys: vi.fn() },
}));
vi.mock("@/infrastructure/database/prisma/repositories/prisma-user-repository", () => ({
  PrismaUserRepository: vi.fn().mockImplementation(() => mockUsers),
}));

const mockExecute = vi.fn();
vi.mock("@/application/use-cases/verification/compose", () => ({
  makeGetVerificationDocumentUseCase: () => ({ execute: mockExecute }),
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
const { GET } = await import("../../../../../src/app/api/documents/verification/[documentId]/route");

const mockedAuth = vi.mocked(auth);

function makeRequest(documentId: string) {
  const request = new NextRequest(`http://localhost:3000/api/documents/verification/${documentId}`);
  return { request, context: { params: Promise.resolve({ documentId }) } };
}

const SAMPLE_DOCUMENT = {
  id: "doc-1",
  verificationId: "v-1",
  fileUrl: "https://res.cloudinary.com/demo/image/private/s--sig--/v1/maestroya/verifications/v-1/doc-1.png",
  originalFilename: "national-id.png",
  mimeType: "image/png",
  fileSizeBytes: 4,
};

describe("GET /api/documents/verification/[documentId]", () => {
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

    const { request, context } = makeRequest("doc-1");
    const response = await GET(request, context);

    expect(response.status).toBe(401);
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it("lets the owning professional download their own document (200, correct headers, no Cloudinary URL leaked)", async () => {
    mockedAuth.mockResolvedValue({
      user: { id: "owner-1", email: "pro@example.com", roles: ["PROVIDER"], signupIntent: null },
    } as never);
    mockExecute.mockResolvedValue(SAMPLE_DOCUMENT);

    const { request, context } = makeRequest("doc-1");
    const response = await GET(request, context);
    const bodyText = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/png");
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(bodyText).toBe("PNGDATA");
    // The whole point of this module's fix: the browser response never
    // contains the underlying, non-expiring Cloudinary URL anywhere.
    expect(JSON.stringify(Object.fromEntries(response.headers.entries()))).not.toContain("cloudinary.com");
    expect(bodyText).not.toContain("cloudinary.com");
    expect(mockExecute).toHaveBeenCalledWith({ userId: "owner-1", isAdmin: false }, "doc-1");
  });

  it("denies a different authenticated user (cross-user IDOR) with a safe, generic denial", async () => {
    mockedAuth.mockResolvedValue({
      user: { id: "attacker-1", email: "attacker@example.com", roles: ["PROVIDER"], signupIntent: null },
    } as never);
    mockExecute.mockRejectedValue(new UnauthorizedError("You do not have permission to view this document."));

    const { request, context } = makeRequest("doc-1");
    const response = await GET(request, context);

    expect(response.status).toBe(401);
    expect(mockFetchDocument).not.toHaveBeenCalled();
  });

  it("allows ADMIN (re-verified fresh via requireRole) and marks the use-case call isAdmin: true", async () => {
    mockedAuth.mockResolvedValue({
      user: { id: "admin-1", email: "admin@example.com", roles: ["ADMIN"], signupIntent: null },
    } as never);
    mockUsers.findById.mockResolvedValue({ id: "admin-1", status: "ACTIVE" });
    mockUsers.getRoleKeys.mockResolvedValue(["ADMIN"]);
    mockExecute.mockResolvedValue(SAMPLE_DOCUMENT);

    const { request, context } = makeRequest("doc-1");
    const response = await GET(request, context);

    expect(response.status).toBe(200);
    expect(mockExecute).toHaveBeenCalledWith({ userId: "admin-1", isAdmin: true }, "doc-1");
  });

  it("treats a demoted admin (stale JWT role, fresh DB role revoked) as a non-admin, falling through to ownership", async () => {
    mockedAuth.mockResolvedValue({
      user: { id: "demoted-1", email: "demoted@example.com", roles: ["ADMIN"], signupIntent: null },
    } as never);
    // Module 82 freshness re-check: DB no longer has this role.
    mockUsers.findById.mockResolvedValue({ id: "demoted-1", status: "ACTIVE" });
    mockUsers.getRoleKeys.mockResolvedValue(["PROVIDER"]);
    mockExecute.mockRejectedValue(new UnauthorizedError("You do not have permission to view this document."));

    const { request, context } = makeRequest("doc-1");
    const response = await GET(request, context);

    expect(response.status).toBe(401);
    expect(mockExecute).toHaveBeenCalledWith({ userId: "demoted-1", isAdmin: false }, "doc-1");
  });

  it("fails safely (404) for a nonexistent or GDPR-erased document id, without leaking which", async () => {
    mockedAuth.mockResolvedValue({
      user: { id: "owner-1", email: "pro@example.com", roles: ["PROVIDER"], signupIntent: null },
    } as never);
    mockExecute.mockRejectedValue(new NotFoundError("VerificationDocument", "doc-missing"));

    const { request, context } = makeRequest("doc-missing");
    const response = await GET(request, context);

    expect(response.status).toBe(404);
  });

  it("never reaches Cloudinary at all when authorization fails first", async () => {
    mockedAuth.mockResolvedValue({
      user: { id: "attacker-1", email: "attacker@example.com", roles: ["PROVIDER"], signupIntent: null },
    } as never);
    mockExecute.mockRejectedValue(new UnauthorizedError("nope"));

    const { request, context } = makeRequest("doc-1");
    await GET(request, context);

    expect(mockFetchDocument).not.toHaveBeenCalled();
  });
});
