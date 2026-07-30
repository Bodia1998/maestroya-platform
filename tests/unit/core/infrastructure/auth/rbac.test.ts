import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

const { auth } = await import("@/lib/auth");
const { getCurrentUser, requireAuth, requireRole } = await import(
  "@/core/infrastructure/auth/rbac"
);

const mockedAuth = vi.mocked(auth);

describe("rbac helpers", () => {
  beforeEach(() => {
    mockedAuth.mockReset();
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

  it("requireRole passes when the user has one of the allowed roles", async () => {
    mockedAuth.mockResolvedValue({
      user: { id: "u1", email: "a@b.com", roles: ["ADMIN"] },
    } as never);

    await expect(requireRole("ADMIN", "SUPER_ADMIN")).resolves.toMatchObject({ id: "u1" });
  });

  it("requireRole throws when the user lacks every allowed role", async () => {
    mockedAuth.mockResolvedValue({
      user: { id: "u1", email: "a@b.com", roles: ["CUSTOMER"] },
    } as never);

    await expect(requireRole("ADMIN", "SUPER_ADMIN")).rejects.toThrow();
  });
});
