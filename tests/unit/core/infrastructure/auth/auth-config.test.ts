import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Tests the `jwt`/`session` callbacks in auth-config.ts directly — the
 * one place `roles` and (Professional Onboarding's) `signupIntent` get
 * from the database into the session/JWT (see middleware.ts, which reads
 * both off `req.auth.user`). `PrismaUserRepository` is the only
 * collaborator mocked (same "mock one collaborator, exercise the real
 * logic" approach as rbac.test.ts mocking `@/lib/auth`) — everything else
 * (providers, PrismaAdapter, env) is the real module, since none of it
 * makes a network/DB call merely by being imported or by these two
 * callbacks running.
 */
const mockUsers = {
  getRoleKeys: vi.fn(),
  getSignupIntent: vi.fn(),
  findByEmail: vi.fn(),
  updateLastLoginAt: vi.fn(),
};

vi.mock("@/infrastructure/database/prisma/repositories/prisma-user-repository", () => ({
  PrismaUserRepository: vi.fn().mockImplementation(() => mockUsers),
}));

const { authConfig } = await import("@/infrastructure/auth/auth-config");

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function callJwt(args: any): Promise<any> {
  return authConfig.callbacks!.jwt!(args);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function callSession(args: any): any {
  return authConfig.callbacks!.session!(args);
}

describe("auth-config.ts jwt/session callbacks", () => {
  beforeEach(() => {
    mockUsers.getRoleKeys.mockReset();
    mockUsers.getSignupIntent.mockReset();
  });

  describe("jwt callback", () => {
    it("reads roles and signupIntent from the database on initial sign-in", async () => {
      mockUsers.getRoleKeys.mockResolvedValue(["CUSTOMER"]);
      mockUsers.getSignupIntent.mockResolvedValue("PROFESSIONAL");

      const token = await callJwt({
        token: {},
        user: { id: "user-1", email: "a@b.com" },
        trigger: "signIn",
      });

      expect(mockUsers.getRoleKeys).toHaveBeenCalledWith("user-1");
      expect(mockUsers.getSignupIntent).toHaveBeenCalledWith("user-1");
      expect(token.roles).toEqual(["CUSTOMER"]);
      expect(token.signupIntent).toBe("PROFESSIONAL");
      expect(token.id).toBe("user-1");
    });

    it("does not query the database when there's no user and no update trigger (regression: token refresh mid-session)", async () => {
      const token = await callJwt({
        token: { id: "user-1", roles: ["CUSTOMER"], signupIntent: null },
        user: undefined,
        trigger: undefined,
      });

      expect(mockUsers.getRoleKeys).not.toHaveBeenCalled();
      expect(mockUsers.getSignupIntent).not.toHaveBeenCalled();
      expect(token.roles).toEqual(["CUSTOMER"]);
    });

    it('refetches both roles and signupIntent on trigger "update" (the mechanism the onboarding form calls via useSession().update())', async () => {
      mockUsers.getRoleKeys.mockResolvedValue(["CUSTOMER", "PROVIDER"]);
      mockUsers.getSignupIntent.mockResolvedValue(null);

      const token = await callJwt({
        token: { id: "user-1", roles: ["CUSTOMER"], signupIntent: "PROFESSIONAL" },
        user: undefined,
        trigger: "update",
      });

      expect(mockUsers.getRoleKeys).toHaveBeenCalledWith("user-1");
      expect(mockUsers.getSignupIntent).toHaveBeenCalledWith("user-1");
      expect(token.roles).toEqual(["CUSTOMER", "PROVIDER"]);
      expect(token.signupIntent).toBeNull();
    });

    it("still applies the extended 'remember me' expiry on sign-in (regression)", async () => {
      mockUsers.getRoleKeys.mockResolvedValue(["CUSTOMER"]);
      mockUsers.getSignupIntent.mockResolvedValue(null);

      const token = await callJwt({
        token: {},
        user: { id: "user-1", email: "a@b.com", rememberMe: true },
        trigger: "signIn",
      });

      expect(token.exp).toBeGreaterThan(Math.floor(Date.now() / 1000) + 29 * 24 * 60 * 60);
    });
  });

  describe("session callback", () => {
    it("copies id, roles, and signupIntent from the token onto session.user", () => {
      const session = callSession({
        session: { user: {}, expires: "2999-01-01" },
        token: { id: "user-1", roles: ["CUSTOMER", "PROVIDER"], signupIntent: "PROFESSIONAL" },
      });

      expect(session.user.id).toBe("user-1");
      expect(session.user.roles).toEqual(["CUSTOMER", "PROVIDER"]);
      expect(session.user.signupIntent).toBe("PROFESSIONAL");
    });

    it("defaults signupIntent to null when the token doesn't carry one (every user before this feature existed)", () => {
      const session = callSession({
        session: { user: {}, expires: "2999-01-01" },
        token: { id: "user-1", roles: ["CUSTOMER"] },
      });

      expect(session.user.signupIntent).toBeNull();
    });

    it("defaults roles to an empty array when the token has none (regression)", () => {
      const session = callSession({
        session: { user: {}, expires: "2999-01-01" },
        token: { id: "user-1" },
      });

      expect(session.user.roles).toEqual([]);
    });
  });
});
