import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Module 146 — Server Action boundary: the professional action trusts only the
 * session, the admin actions require ADMIN/SUPER_ADMIN before anything else.
 */
const mockRequireAuth = vi.fn();
const mockRequireRole = vi.fn();
const mockSave = vi.fn();
const mockVerify = vi.fn();
const mockReject = vi.fn();
const mockRevalidatePath = vi.fn();

vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => mockRevalidatePath(...a) }));
vi.mock("@/infrastructure/auth/rbac", () => ({
  ROLES: { ADMIN: "ADMIN", SUPER_ADMIN: "SUPER_ADMIN" },
  requireAuth: () => mockRequireAuth(),
  requireRole: (...a: string[]) => mockRequireRole(...a),
}));
vi.mock("@/application/use-cases/billing-identity/compose", () => ({
  makeSaveMyBillingIdentityUseCase: () => ({ execute: mockSave }),
  makeVerifyBillingIdentityUseCase: () => ({ execute: mockVerify }),
  makeRejectBillingIdentityUseCase: () => ({ execute: mockReject }),
}));

const { saveBillingIdentityAction } = await import("../../../src/app/(dashboard)/dashboard/professional/billing/actions");
const { verifyBillingIdentityAction, rejectBillingIdentityAction } = await import("../../../src/app/(dashboard)/admin/billing-identities/actions");
const { UnauthorizedError, ConflictError } = await import("../../../src/core/domain/errors/domain-error");

const VALID = {
  entityType: "COMPANY",
  legalName: "Acme S.L.",
  taxId: "b-12345674",
  taxCountry: "es",
  addressLine1: "Calle Mayor 1",
  city: "Madrid",
  postalCode: "28001",
  country: "es",
};
const UUID = "11111111-1111-4111-8111-111111111111";

describe("saveBillingIdentityAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue({ id: "session-user", email: "a@b.c", roles: [] });
    mockSave.mockResolvedValue({ state: "PENDING_REVIEW" });
  });

  it("acts for the session user only and never forwards client-supplied identity or status", async () => {
    const result = await saveBillingIdentityAction({
      ...VALID,
      userId: "victim-user",
      professionalProfileId: "victim-profile",
      id: "victim-identity",
      verificationStatus: "VERIFIED",
      verifiedAt: "2026-01-01T00:00:00.000Z",
      reviewedByUserId: "admin",
      revision: 7,
    });
    expect(result).toEqual({ success: true, state: "PENDING_REVIEW" });
    expect(mockSave).toHaveBeenCalledTimes(1);
    const [userId, input] = mockSave.mock.calls[0] ?? [];
    expect(userId).toBe("session-user");
    expect(input.taxId).toBe("B12345674");
    expect(input.taxCountry).toBe("ES");
    expect(JSON.stringify(input)).not.toMatch(/victim|VERIFIED|verifiedAt|reviewedByUserId|revision/);
    expect(mockRevalidatePath).toHaveBeenCalledWith("/dashboard/professional/billing");
  });

  it("requires authentication before anything else", async () => {
    mockRequireAuth.mockRejectedValue(new UnauthorizedError());
    await expect(saveBillingIdentityAction(VALID)).rejects.toBeInstanceOf(UnauthorizedError);
    expect(mockSave).not.toHaveBeenCalled();
  });

  it("returns field errors for invalid input without reaching the use case", async () => {
    const result = await saveBillingIdentityAction({ ...VALID, taxId: "!!", country: "Spain" });
    expect(result.success).toBe(false);
    if (!result.success) expect(Object.keys(result.fieldErrors ?? {}).sort()).toEqual(["country", "taxId"]);
    expect(mockSave).not.toHaveBeenCalled();
  });

  it("localises unexpected failures instead of leaking internals (incl. tax id)", async () => {
    mockSave.mockRejectedValue(new Error("db exploded for B12345674"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const result = await saveBillingIdentityAction(VALID);
    spy.mockRestore();
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).not.toContain("B12345674");
  });
});

describe("admin billing identity actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireRole.mockResolvedValue({ id: "admin-1" });
    mockVerify.mockResolvedValue({});
    mockReject.mockResolvedValue({});
  });

  it.each([
    ["verify", () => verifyBillingIdentityAction(UUID, 1)],
    ["reject", () => rejectBillingIdentityAction(UUID, 1, "OTHER")],
  ])("%s requires ADMIN/SUPER_ADMIN and never reaches the use case when denied", async (_n, call) => {
    mockRequireRole.mockRejectedValue(new UnauthorizedError());
    await expect(call()).rejects.toBeInstanceOf(UnauthorizedError);
    expect(mockRequireRole).toHaveBeenCalledWith("ADMIN", "SUPER_ADMIN");
    expect(mockVerify).not.toHaveBeenCalled();
    expect(mockReject).not.toHaveBeenCalled();
  });

  it("verify uses the session admin id and the reviewed revision", async () => {
    expect(await verifyBillingIdentityAction(UUID, 3)).toEqual({ success: true });
    expect(mockVerify).toHaveBeenCalledWith("admin-1", { identityId: UUID, expectedRevision: 3 });
  });

  it("reject uses the session admin id, a closed reason and the reviewed revision", async () => {
    expect(await rejectBillingIdentityAction(UUID, 2, "ADDRESS_INVALID", "  internal ")).toEqual({ success: true });
    expect(mockReject).toHaveBeenCalledWith("admin-1", { identityId: UUID, expectedRevision: 2, reason: "ADDRESS_INVALID", note: "internal" });
  });

  it("rejects malformed ids, revisions and reasons before the use case", async () => {
    expect((await verifyBillingIdentityAction("not-a-uuid", 1)).success).toBe(false);
    expect((await verifyBillingIdentityAction(UUID, 0)).success).toBe(false);
    expect((await rejectBillingIdentityAction(UUID, 1, "FREE_TEXT_REASON")).success).toBe(false);
    expect(mockVerify).not.toHaveBeenCalled();
    expect(mockReject).not.toHaveBeenCalled();
  });

  it("surfaces a stale-review conflict as a localised failure", async () => {
    mockVerify.mockRejectedValue(new ConflictError("This billing identity changed or was already reviewed. Reload and review the current details."));
    const result = await verifyBillingIdentityAction(UUID, 1);
    expect(result.success).toBe(false);
  });
});
