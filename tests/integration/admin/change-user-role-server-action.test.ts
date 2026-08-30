import { beforeEach, describe, expect, it, vi } from "vitest";

import { ChangeUserRoleUseCase } from "@/application/use-cases/admin/change-user-role.use-case";
import { FakeAdminAuditLogRepository, FakeAdminRepository } from "./fakes";
import { FakeSecurityEventRepository } from "../security/fakes";

/**
 * Module 82 — Admin RBAC & Production Auth Hardening (finding B1):
 * end-to-end proof that the privilege-escalation restriction cannot be
 * bypassed by calling the real Server Action directly — i.e. by skipping
 * whatever the admin UI does or doesn't disable.
 *
 * Only two things are mocked: the NextAuth session (`@/lib/auth`, same
 * convention as admin-flows.test.ts) and the composition root
 * (`@/application/use-cases/admin/compose`), swapped for the *real*
 * `ChangeUserRoleUseCase` wired to in-memory fakes instead of Prisma — the
 * only thing that changes is which repository backs the use case, not the
 * use case's own logic. `changeUserRoleAction` itself
 * (src/app/(dashboard)/admin/actions.ts) is the genuine, unmodified Server
 * Action a form submission or a hand-crafted client request would invoke.
 *
 * User ids here are real UUIDs (not the fake repository's default
 * `fake-user-N` ids) because `changeUserRoleSchema` — the real Zod schema
 * this Server Action validates its input against — requires `userId` to be
 * a UUID; this test exercises that real validation too, not a bypass of it.
 */
const CALLER_ID = "11111111-1111-4111-8111-111111111111";
const TARGET_ID = "22222222-2222-4222-8222-222222222222";

const mockedRequireRoleUsers = {
  findById: vi.fn(),
  getRoleKeys: vi.fn(),
};

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/infrastructure/database/prisma/repositories/prisma-user-repository", () => ({
  PrismaUserRepository: vi.fn().mockImplementation(() => mockedRequireRoleUsers),
}));

let admins: FakeAdminRepository;
let auditLog: FakeAdminAuditLogRepository;
let securityEvents: FakeSecurityEventRepository;

vi.mock("@/application/use-cases/admin/compose", () => ({
  makeChangeUserRoleUseCase: () => new ChangeUserRoleUseCase(admins, auditLog, securityEvents),
  makeGetAdminDashboardOverviewUseCase: vi.fn(),
  makeListAdminAuditLogsUseCase: vi.fn(),
  makeListAdminJobsUseCase: vi.fn(),
  makeListAdminPortfolioItemsUseCase: vi.fn(),
  makeListAdminProfessionalsUseCase: vi.fn(),
  makeListAdminQuotesUseCase: vi.fn(),
  makeListAdminReviewsUseCase: vi.fn(),
  makeListAdminServiceRequestsUseCase: vi.fn(),
  makeListAdminUsersUseCase: vi.fn(),
  makeModeratePortfolioItemUseCase: vi.fn(),
  makeModerateReviewUseCase: vi.fn(),
  makeReactivateAdminUserUseCase: vi.fn(),
  makeRestorePortfolioItemUseCase: vi.fn(),
  makeRestoreReviewUseCase: vi.fn(),
  makeSuspendAdminUserUseCase: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

const { auth } = await import("@/lib/auth");
const mockedAuth = vi.mocked(auth);
const { changeUserRoleAction } = await import("../../../src/app/(dashboard)/admin/actions");

describe("changeUserRoleAction — Server Action cannot bypass the ADMIN privilege-escalation restriction (Module 82, finding B1)", () => {
  beforeEach(() => {
    mockedAuth.mockReset();
    mockedRequireRoleUsers.findById.mockReset();
    mockedRequireRoleUsers.getRoleKeys.mockReset();
    admins = new FakeAdminRepository();
    auditLog = new FakeAdminAuditLogRepository();
    securityEvents = new FakeSecurityEventRepository();
  });

  it("an ADMIN calling the real Server Action directly cannot grant ADMIN — REJECTED", async () => {
    admins.seedUser({ id: CALLER_ID, status: "ACTIVE", roles: ["ADMIN"] });
    admins.seedUser({ id: TARGET_ID, status: "ACTIVE", roles: ["CUSTOMER"] });

    mockedAuth.mockResolvedValue({
      user: { id: CALLER_ID, email: "admin@example.com", roles: ["ADMIN"] },
    } as never);
    mockedRequireRoleUsers.findById.mockResolvedValue({ id: CALLER_ID, status: "ACTIVE" });
    mockedRequireRoleUsers.getRoleKeys.mockResolvedValue(["ADMIN"]);

    const result = await changeUserRoleAction(TARGET_ID, ["ADMIN"]);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/SUPER_ADMIN/);
    }
    expect((await admins.getUserById(TARGET_ID))?.roles).toEqual(["CUSTOMER"]);
    expect(securityEvents.events).toHaveLength(1);
    expect(securityEvents.events[0]?.type).toBe("SECURITY_POLICY_BLOCKED");
  });

  it("an ADMIN calling the real Server Action directly cannot grant SUPER_ADMIN — REJECTED", async () => {
    admins.seedUser({ id: CALLER_ID, status: "ACTIVE", roles: ["ADMIN"] });
    admins.seedUser({ id: TARGET_ID, status: "ACTIVE", roles: ["CUSTOMER"] });

    mockedAuth.mockResolvedValue({
      user: { id: CALLER_ID, email: "admin@example.com", roles: ["ADMIN"] },
    } as never);
    mockedRequireRoleUsers.findById.mockResolvedValue({ id: CALLER_ID, status: "ACTIVE" });
    mockedRequireRoleUsers.getRoleKeys.mockResolvedValue(["ADMIN"]);

    const result = await changeUserRoleAction(TARGET_ID, ["SUPER_ADMIN"]);

    expect(result.success).toBe(false);
    expect((await admins.getUserById(TARGET_ID))?.roles).toEqual(["CUSTOMER"]);
  });

  it("an ADMIN calling the real Server Action directly cannot self-promote to ADMIN/SUPER_ADMIN — REJECTED", async () => {
    admins.seedUser({ id: CALLER_ID, status: "ACTIVE", roles: ["ADMIN"] });

    mockedAuth.mockResolvedValue({
      user: { id: CALLER_ID, email: "admin@example.com", roles: ["ADMIN"] },
    } as never);
    mockedRequireRoleUsers.findById.mockResolvedValue({ id: CALLER_ID, status: "ACTIVE" });
    mockedRequireRoleUsers.getRoleKeys.mockResolvedValue(["ADMIN"]);

    const result = await changeUserRoleAction(CALLER_ID, ["ADMIN", "SUPER_ADMIN"]);

    expect(result.success).toBe(false);
    expect((await admins.getUserById(CALLER_ID))?.roles).toEqual(["ADMIN"]);
  });

  it("a SUPER_ADMIN calling the real Server Action directly CAN grant ADMIN — ALLOWED", async () => {
    admins.seedUser({ id: CALLER_ID, status: "ACTIVE", roles: ["SUPER_ADMIN"] });
    admins.seedUser({ id: TARGET_ID, status: "ACTIVE", roles: ["CUSTOMER"] });

    mockedAuth.mockResolvedValue({
      user: { id: CALLER_ID, email: "super@example.com", roles: ["SUPER_ADMIN"] },
    } as never);
    mockedRequireRoleUsers.findById.mockResolvedValue({ id: CALLER_ID, status: "ACTIVE" });
    mockedRequireRoleUsers.getRoleKeys.mockResolvedValue(["SUPER_ADMIN"]);

    const result = await changeUserRoleAction(TARGET_ID, ["ADMIN"]);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.roles).toEqual(["ADMIN"]);
    }
  });

  it("a SUPER_ADMIN calling the real Server Action directly CAN grant SUPER_ADMIN — ALLOWED", async () => {
    admins.seedUser({ id: CALLER_ID, status: "ACTIVE", roles: ["SUPER_ADMIN"] });
    admins.seedUser({ id: TARGET_ID, status: "ACTIVE", roles: ["CUSTOMER"] });

    mockedAuth.mockResolvedValue({
      user: { id: CALLER_ID, email: "super@example.com", roles: ["SUPER_ADMIN"] },
    } as never);
    mockedRequireRoleUsers.findById.mockResolvedValue({ id: CALLER_ID, status: "ACTIVE" });
    mockedRequireRoleUsers.getRoleKeys.mockResolvedValue(["SUPER_ADMIN"]);

    const result = await changeUserRoleAction(TARGET_ID, ["SUPER_ADMIN"]);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.roles).toEqual(["SUPER_ADMIN"]);
    }
  });

  it("a demoted ADMIN (stale JWT still says ADMIN, fresh DB says CUSTOMER) is rejected at the RBAC boundary before the use case even runs", async () => {
    admins.seedUser({ id: CALLER_ID, status: "ACTIVE", roles: ["CUSTOMER"] });
    admins.seedUser({ id: TARGET_ID, status: "ACTIVE", roles: ["CUSTOMER"] });

    mockedAuth.mockResolvedValue({
      user: { id: CALLER_ID, email: "demoted@example.com", roles: ["ADMIN"] },
    } as never);
    mockedRequireRoleUsers.findById.mockResolvedValue({ id: CALLER_ID, status: "ACTIVE" });
    // Fresh DB roles no longer include ADMIN — the stale JWT claim alone
    // must not be enough (Module 82's JWT/admin-role freshness fix).
    // requireRole() throws before changeUserRoleAction's own try/catch, so
    // the whole action rejects rather than resolving to { success: false }.
    mockedRequireRoleUsers.getRoleKeys.mockResolvedValue(["CUSTOMER"]);

    await expect(changeUserRoleAction(TARGET_ID, ["PROVIDER"])).rejects.toThrow(
      "You do not have permission to do that.",
    );
    expect((await admins.getUserById(TARGET_ID))?.roles).toEqual(["CUSTOMER"]);
  });
});
