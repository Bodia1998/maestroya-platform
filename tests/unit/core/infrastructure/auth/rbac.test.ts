import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

/**
 * Module 82 — Admin RBAC & Production Auth Hardening: `requireRole()` now
 * re-verifies status/roles fresh from the DB for admin-tier checks (see
 * rbac.ts's own doc comment on why) — `PrismaUserRepository` is the one
 * collaborator mocked for that, same "mock one collaborator, exercise the
 * real logic" convention as auth-config.test.ts mocking the same module.
 */
const mockUsers = {
  findById: vi.fn(),
  getRoleKeys: vi.fn(),
};

vi.mock("@/infrastructure/database/prisma/repositories/prisma-user-repository", () => ({
  PrismaUserRepository: vi.fn().mockImplementation(() => mockUsers),
}));

const { auth } = await import("@/lib/auth");
const { getCurrentUser, requireAuth, requireRole } = await import(
  "@/core/infrastructure/auth/rbac"
);

const mockedAuth = vi.mocked(auth);

describe("rbac helpers", () => {
  beforeEach(() => {
    mockedAuth.mockReset();
    mockUsers.findById.mockReset();
    mockUsers.getRoleKeys.mockReset();
    // Sane default: an ACTIVE user with the same roles the session already
    // carries. Tests that exercise the freshness check override this.
    mockUsers.findById.mockResolvedValue({ id: "u1", status: "ACTIVE" });
    mockUsers.getRoleKeys.mockResolvedValue(["ADMIN"]);
  });

  it("getCurrentUser returns null when no session", async () => {
    mockedAuth.mockResolvedValue(null as never);
    expect(await getCurrentUser()).toBeNull();
  });

  it("getCurrentUser returns id/email/roles when signed in", async () => {
    mockedAuth.mockResolvedValue({
      user: { id: "u1", email: "a@b.com", roles: ["CUSTOMER"], signupIntent: null },
    } as never);

    expect(await getCurrentUser()).toEqual({
      id: "u1",
      email: "a@b.com",
      roles: ["CUSTOMER"],
      signupIntent: null,
    });
  });

  /**
   * Professional Onboarding: `signupIntent` is read straight through from
   * the session (see auth-config.ts's own jwt/session callbacks for how it
   * gets there) — this is the one seam middleware.ts and the rest of the
   * app read it from, so it must survive this pass-through unchanged.
   */
  it("getCurrentUser passes through a PROFESSIONAL signupIntent from the session", async () => {
    mockedAuth.mockResolvedValue({
      user: { id: "u1", email: "a@b.com", roles: ["CUSTOMER"], signupIntent: "PROFESSIONAL" },
    } as never);

    expect(await getCurrentUser()).toEqual({
      id: "u1",
      email: "a@b.com",
      roles: ["CUSTOMER"],
      signupIntent: "PROFESSIONAL",
    });
  });

  it("requireAuth throws when signed out", async () => {
    mockedAuth.mockResolvedValue(null as never);
    await expect(requireAuth()).rejects.toThrow();
  });

  it("requireRole passes when the user has one of the allowed roles (non-admin check skips the DB freshness read)", async () => {
    mockedAuth.mockResolvedValue({
      user: { id: "u1", email: "a@b.com", roles: ["CUSTOMER"] },
    } as never);

    await expect(requireRole("CUSTOMER", "PROVIDER")).resolves.toMatchObject({ id: "u1" });
    expect(mockUsers.findById).not.toHaveBeenCalled();
    expect(mockUsers.getRoleKeys).not.toHaveBeenCalled();
  });

  it("requireRole throws when the user lacks every allowed role", async () => {
    mockedAuth.mockResolvedValue({
      user: { id: "u1", email: "a@b.com", roles: ["CUSTOMER"] },
    } as never);

    await expect(requireRole("ADMIN", "SUPER_ADMIN")).rejects.toThrow();
  });

  describe("admin-tier freshness check (Module 82 — JWT/admin-role freshness gap)", () => {
    it("passes for an ADMIN whose session role still matches their current, fresh DB status/role", async () => {
      mockedAuth.mockResolvedValue({
        user: { id: "admin-1", email: "a@b.com", roles: ["ADMIN"] },
      } as never);
      mockUsers.findById.mockResolvedValue({ id: "admin-1", status: "ACTIVE" });
      mockUsers.getRoleKeys.mockResolvedValue(["ADMIN"]);

      await expect(requireRole("ADMIN", "SUPER_ADMIN")).resolves.toMatchObject({
        id: "admin-1",
        roles: ["ADMIN"],
      });
      expect(mockUsers.findById).toHaveBeenCalledWith("admin-1");
      expect(mockUsers.getRoleKeys).toHaveBeenCalledWith("admin-1");
    });

    it("rejects a session that still carries a stale ADMIN claim after the user was demoted in the DB", async () => {
      mockedAuth.mockResolvedValue({
        user: { id: "admin-1", email: "a@b.com", roles: ["ADMIN"] },
      } as never);
      mockUsers.findById.mockResolvedValue({ id: "admin-1", status: "ACTIVE" });
      // Demoted: the DB no longer has ADMIN, even though the JWT still does.
      mockUsers.getRoleKeys.mockResolvedValue(["CUSTOMER"]);

      await expect(requireRole("ADMIN", "SUPER_ADMIN")).rejects.toThrow(
        "You do not have permission to do that.",
      );
    });

    it("rejects a session that still carries a stale ADMIN claim after the user was suspended in the DB", async () => {
      mockedAuth.mockResolvedValue({
        user: { id: "admin-1", email: "a@b.com", roles: ["ADMIN"] },
      } as never);
      mockUsers.findById.mockResolvedValue({ id: "admin-1", status: "SUSPENDED" });
      mockUsers.getRoleKeys.mockResolvedValue(["ADMIN"]);

      await expect(requireRole("ADMIN", "SUPER_ADMIN")).rejects.toThrow(
        "You do not have permission to do that.",
      );
    });

    it("rejects when the user record no longer exists in the DB", async () => {
      mockedAuth.mockResolvedValue({
        user: { id: "admin-1", email: "a@b.com", roles: ["ADMIN"] },
      } as never);
      mockUsers.findById.mockResolvedValue(null);

      await expect(requireRole("ADMIN", "SUPER_ADMIN")).rejects.toThrow(
        "You do not have permission to do that.",
      );
    });

    it("does not run the freshness check for a SUPPORT-only allowed list mixed with ADMIN/SUPER_ADMIN when the caller is genuinely fresh SUPPORT", async () => {
      mockedAuth.mockResolvedValue({
        user: { id: "support-1", email: "s@b.com", roles: ["SUPPORT"] },
      } as never);
      mockUsers.findById.mockResolvedValue({ id: "support-1", status: "ACTIVE" });
      mockUsers.getRoleKeys.mockResolvedValue(["SUPPORT"]);

      await expect(requireRole("ADMIN", "SUPER_ADMIN", "SUPPORT")).resolves.toMatchObject({
        id: "support-1",
      });
    });
  });
});
