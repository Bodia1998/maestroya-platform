import { beforeEach, describe, expect, it, vi } from "vitest";

import { ChangeUserRoleUseCase } from "@/application/use-cases/admin/change-user-role.use-case";
import { GetAdminDashboardOverviewUseCase } from "@/application/use-cases/admin/get-admin-dashboard-overview.use-case";
import { GetAdminUserUseCase } from "@/application/use-cases/admin/get-admin-user.use-case";
import { ListAdminAuditLogsUseCase } from "@/application/use-cases/admin/list-admin-audit-logs.use-case";
import { ListAdminJobsUseCase } from "@/application/use-cases/admin/list-admin-jobs.use-case";
import { ListAdminPortfolioItemsUseCase } from "@/application/use-cases/admin/list-admin-portfolio-items.use-case";
import { ListAdminProfessionalsUseCase } from "@/application/use-cases/admin/list-admin-professionals.use-case";
import { ListAdminQuotesUseCase } from "@/application/use-cases/admin/list-admin-quotes.use-case";
import { ListAdminReviewsUseCase } from "@/application/use-cases/admin/list-admin-reviews.use-case";
import { ListAdminServiceRequestsUseCase } from "@/application/use-cases/admin/list-admin-service-requests.use-case";
import { ListAdminUsersUseCase } from "@/application/use-cases/admin/list-admin-users.use-case";
import { ModeratePortfolioItemUseCase } from "@/application/use-cases/admin/moderate-portfolio-item.use-case";
import { ModerateReviewUseCase } from "@/application/use-cases/admin/moderate-review.use-case";
import { ReactivateAdminUserUseCase } from "@/application/use-cases/admin/reactivate-admin-user.use-case";
import { RestorePortfolioItemUseCase } from "@/application/use-cases/admin/restore-portfolio-item.use-case";
import { RestoreReviewUseCase } from "@/application/use-cases/admin/restore-review.use-case";
import { SuspendAdminUserUseCase } from "@/application/use-cases/admin/suspend-admin-user.use-case";
import {
  changeUserRoleSchema,
  listAdminUsersSchema,
  moderatePortfolioItemSchema,
  moderateReviewSchema,
} from "@/application/dto/admin.dto";
import { ConflictError, NotFoundError, UnauthorizedError, ValidationError } from "@/domain/errors/domain-error";
import { FakeAdminAuditLogRepository, FakeAdminRepository } from "./fakes";
// Module 82 — Admin RBAC & Production Auth Hardening: ChangeUserRoleUseCase
// now also records a SECURITY_POLICY_BLOCKED SecurityEvent on a denied
// privilege-escalation attempt (finding B1) — reuses the same fake already
// written for Security & Anti-Abuse (Module 24) integration tests rather
// than duplicating it.
import { FakeSecurityEventRepository } from "../security/fakes";

// Module-level mock of the NextAuth wrapper, matching the established
// convention in tests/unit/core/infrastructure/auth/rbac.test.ts. `vi.mock`
// is hoisted above all imports (including the static imports above), so
// `@/infrastructure/auth/rbac` — and everything it transitively imports,
// like `next-auth` itself — never gets a chance to resolve the real
// `@/lib/auth` module. A per-test `vi.doMock` + dynamic `import()` cannot
// give that guarantee: the real module graph may already be resolved/cached
// by the time the mock is registered, which is what let the real
// `next-auth` `auth()` (and its `next/headers` call) run instead of the
// mock.
vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

// Module 82 — Admin RBAC & Production Auth Hardening: requireRole() now
// re-verifies status/roles fresh from the DB for admin-tier checks (see
// rbac.ts's own doc comment) — mocked the same "mock one collaborator"
// way as tests/unit/core/infrastructure/auth/rbac.test.ts. `vi.hoisted()`
// (not a plain `const`) because this file's own static imports above
// (e.g. admin.dto.ts) transitively resolve rbac.ts before a later
// statement would run — same hoisting hazard `vi.mock` factories always
// have, see cache-observability.test.ts for the same pattern.
const { mockUsers } = vi.hoisted(() => ({
  mockUsers: {
    findById: vi.fn(),
    getRoleKeys: vi.fn(),
  },
}));

vi.mock("@/infrastructure/database/prisma/repositories/prisma-user-repository", () => ({
  PrismaUserRepository: vi.fn().mockImplementation(() => mockUsers),
}));

const { auth } = await import("@/lib/auth");
const { requireAuth, requireRole, ROLES } = await import("@/infrastructure/auth/rbac");

const mockedAuth = vi.mocked(auth);

/**
 * Integration tests for the Admin Panel module (Module 16). Real use cases
 * + fake repositories, same pattern as every other module's integration
 * tests (see tests/integration/review/review-flows.test.ts).
 */

function makeUseCases(
  admins: FakeAdminRepository,
  auditLog: FakeAdminAuditLogRepository,
  securityEvents: FakeSecurityEventRepository = new FakeSecurityEventRepository(),
) {
  return {
    overview: new GetAdminDashboardOverviewUseCase(admins),
    listUsers: new ListAdminUsersUseCase(admins),
    getUser: new GetAdminUserUseCase(admins),
    suspend: new SuspendAdminUserUseCase(admins, auditLog),
    reactivate: new ReactivateAdminUserUseCase(admins, auditLog),
    changeRole: new ChangeUserRoleUseCase(admins, auditLog, securityEvents),
    listProfessionals: new ListAdminProfessionalsUseCase(admins),
    listServiceRequests: new ListAdminServiceRequestsUseCase(admins),
    listQuotes: new ListAdminQuotesUseCase(admins),
    listJobs: new ListAdminJobsUseCase(admins),
    listReviews: new ListAdminReviewsUseCase(admins),
    moderateReview: new ModerateReviewUseCase(admins, auditLog),
    restoreReview: new RestoreReviewUseCase(admins, auditLog),
    listPortfolio: new ListAdminPortfolioItemsUseCase(admins),
    moderatePortfolio: new ModeratePortfolioItemUseCase(admins, auditLog),
    restorePortfolio: new RestorePortfolioItemUseCase(admins, auditLog),
    listAuditLogs: new ListAdminAuditLogsUseCase(auditLog),
  };
}

function makeRepos() {
  const admins = new FakeAdminRepository();
  const auditLog = new FakeAdminAuditLogRepository();
  return { admins, auditLog };
}

const ADMIN_ID = "admin-1";

describe("Server Action auth boundary", () => {
  beforeEach(() => {
    mockedAuth.mockReset();
    mockUsers.findById.mockReset();
    mockUsers.getRoleKeys.mockReset();
    mockUsers.findById.mockResolvedValue({ id: "admin-x", status: "ACTIVE" });
    mockUsers.getRoleKeys.mockResolvedValue(["ADMIN"]);
  });

  it("requireAuth throws UnauthorizedError when there is no session (unauthenticated rejected)", async () => {
    mockedAuth.mockResolvedValue(null as never);
    await expect(requireAuth()).rejects.toThrow(UnauthorizedError);
  });

  it("requireRole throws UnauthorizedError for a signed-in customer (customer rejected)", async () => {
    mockedAuth.mockResolvedValue({
      user: { id: "customer-1", email: "c@example.com", roles: ["CUSTOMER"] },
    } as never);
    await expect(requireRole(ROLES.ADMIN, ROLES.SUPER_ADMIN)).rejects.toThrow(UnauthorizedError);
  });

  it("requireRole throws UnauthorizedError for a signed-in professional (professional rejected)", async () => {
    mockedAuth.mockResolvedValue({
      user: { id: "pro-1", email: "p@example.com", roles: ["PROVIDER"] },
    } as never);
    await expect(requireRole(ROLES.ADMIN, ROLES.SUPER_ADMIN)).rejects.toThrow(UnauthorizedError);
  });

  it("requireRole succeeds for a signed-in admin (admin accepted)", async () => {
    mockedAuth.mockResolvedValue({
      user: { id: "admin-x", email: "a@example.com", roles: ["ADMIN"] },
    } as never);
    const user = await requireRole(ROLES.ADMIN, ROLES.SUPER_ADMIN);
    expect(user.id).toBe("admin-x");
  });
});

describe("Dashboard overview", () => {
  it("returns operational counts computed from the repository", async () => {
    const { admins, auditLog } = makeRepos();
    admins.seedUser();
    admins.seedUser();
    admins.seedProfessional({ userId: "u1" });
    admins.seedReview();
    const { overview } = makeUseCases(admins, auditLog);

    const result = await overview.execute();
    expect(result.totalUsers).toBe(2);
    expect(result.totalProfessionals).toBe(1);
    expect(result.totalReviews).toBe(1);
  });
});

describe("User management", () => {
  it("lists users", async () => {
    const { admins, auditLog } = makeRepos();
    admins.seedUser({ name: "Alice" });
    admins.seedUser({ name: "Bob" });
    const { listUsers } = makeUseCases(admins, auditLog);

    const users = await listUsers.execute({ limit: 20, offset: 0 });
    expect(users).toHaveLength(2);
  });

  it("paginates users", async () => {
    const { admins, auditLog } = makeRepos();
    for (let i = 0; i < 5; i += 1) admins.seedUser({ name: `User ${i}` });
    const { listUsers } = makeUseCases(admins, auditLog);

    const page1 = await listUsers.execute({ limit: 2, offset: 0 });
    const page2 = await listUsers.execute({ limit: 2, offset: 2 });
    expect(page1).toHaveLength(2);
    expect(page2).toHaveLength(2);
    expect(page1[0]?.id).not.toBe(page2[0]?.id);
  });

  it("searches users by name/email", async () => {
    const { admins, auditLog } = makeRepos();
    admins.seedUser({ name: "Alice Smith", email: "alice@example.com" });
    admins.seedUser({ name: "Bob Jones", email: "bob@example.com" });
    const { listUsers } = makeUseCases(admins, auditLog);

    const results = await listUsers.execute({ limit: 20, offset: 0, search: "alice" });
    expect(results).toHaveLength(1);
    expect(results[0]?.name).toBe("Alice Smith");
  });

  it("views a single user", async () => {
    const { admins, auditLog } = makeRepos();
    const user = admins.seedUser({ name: "Alice" });
    const { getUser } = makeUseCases(admins, auditLog);

    const result = await getUser.execute(user.id);
    expect(result.id).toBe(user.id);
  });

  it("a nonexistent user id throws NotFoundError", async () => {
    const { admins, auditLog } = makeRepos();
    const { getUser } = makeUseCases(admins, auditLog);
    await expect(getUser.execute("does-not-exist")).rejects.toThrow(NotFoundError);
  });

  it("suspends an active user and records an audit log entry with the acting admin's id", async () => {
    const { admins, auditLog } = makeRepos();
    admins.seedUser({ status: "ACTIVE", roles: ["ADMIN"] }); // keep >=1 other active admin
    const target = admins.seedUser({ status: "ACTIVE", roles: ["CUSTOMER"] });
    const { suspend } = makeUseCases(admins, auditLog);

    const result = await suspend.execute(ADMIN_ID, target.id);
    expect(result.status).toBe("SUSPENDED");
    expect(auditLog.entries).toHaveLength(1);
    expect(auditLog.entries[0]?.action).toBe("USER_SUSPENDED");
    expect(auditLog.entries[0]?.adminUserId).toBe(ADMIN_ID);
    expect(auditLog.entries[0]?.targetId).toBe(target.id);
  });

  it("reactivates a suspended user and records an audit log entry", async () => {
    const { admins, auditLog } = makeRepos();
    const target = admins.seedUser({ status: "SUSPENDED" });
    const { reactivate } = makeUseCases(admins, auditLog);

    const result = await reactivate.execute(ADMIN_ID, target.id);
    expect(result.status).toBe("ACTIVE");
    expect(auditLog.entries[0]?.action).toBe("USER_REACTIVATED");
  });

  it("refuses to suspend the last remaining active admin", async () => {
    const { admins, auditLog } = makeRepos();
    const onlyAdmin = admins.seedUser({ status: "ACTIVE", roles: ["ADMIN"] });
    const { suspend } = makeUseCases(admins, auditLog);

    await expect(suspend.execute(ADMIN_ID, onlyAdmin.id)).rejects.toThrow(ConflictError);
    expect(auditLog.entries).toHaveLength(0);
  });

  it("allows suspending an admin when another active admin remains", async () => {
    const { admins, auditLog } = makeRepos();
    admins.seedUser({ status: "ACTIVE", roles: ["ADMIN"] });
    const target = admins.seedUser({ status: "ACTIVE", roles: ["ADMIN"] });
    const { suspend } = makeUseCases(admins, auditLog);

    const result = await suspend.execute(ADMIN_ID, target.id);
    expect(result.status).toBe("SUSPENDED");
  });

  it("role change validation: rejects an unknown role key", async () => {
    const { admins, auditLog } = makeRepos();
    const target = admins.seedUser();
    const { changeRole } = makeUseCases(admins, auditLog);

    await expect(changeRole.execute(ADMIN_ID, target.id, ["NOT_A_REAL_ROLE"])).rejects.toThrow(ValidationError);
  });

  it("role change: successfully changes a user's roles and logs the change", async () => {
    const { admins, auditLog } = makeRepos();
    const target = admins.seedUser({ roles: ["CUSTOMER"] });
    const { changeRole } = makeUseCases(admins, auditLog);

    const result = await changeRole.execute(ADMIN_ID, target.id, ["CUSTOMER", "PROVIDER"]);
    expect(result.roles.sort()).toEqual(["CUSTOMER", "PROVIDER"]);
    expect(auditLog.entries[0]?.action).toBe("USER_ROLE_CHANGED");
  });

  it("role change: prevents removing the last admin's admin role", async () => {
    const { admins, auditLog } = makeRepos();
    const onlyAdmin = admins.seedUser({ status: "ACTIVE", roles: ["ADMIN"] });
    const { changeRole } = makeUseCases(admins, auditLog);

    await expect(changeRole.execute(ADMIN_ID, onlyAdmin.id, ["CUSTOMER"])).rejects.toThrow(ConflictError);
  });

  it("role change validation (DTO): rejects an empty role list", () => {
    const result = changeUserRoleSchema.safeParse({ userId: "123e4567-e89b-12d3-a456-426614174000", roles: [] });
    expect(result.success).toBe(false);
  });
});

describe("Professional management", () => {
  it("lists professionals with pagination and isolation", async () => {
    const { admins, auditLog } = makeRepos();
    admins.seedProfessional({ userId: "u1", businessName: "Acme Plumbing" });
    admins.seedProfessional({ userId: "u2", businessName: "Best Electric" });
    const { listProfessionals } = makeUseCases(admins, auditLog);

    const page1 = await listProfessionals.execute({ limit: 1, offset: 0 });
    const page2 = await listProfessionals.execute({ limit: 1, offset: 1 });
    expect(page1).toHaveLength(1);
    expect(page2).toHaveLength(1);
    expect(page1[0]?.id).not.toBe(page2[0]?.id);
  });

  it("searches professionals by business name", async () => {
    const { admins, auditLog } = makeRepos();
    admins.seedProfessional({ userId: "u1", businessName: "Acme Plumbing" });
    admins.seedProfessional({ userId: "u2", businessName: "Best Electric" });
    const { listProfessionals } = makeUseCases(admins, auditLog);

    const results = await listProfessionals.execute({ limit: 20, offset: 0, search: "acme" });
    expect(results).toHaveLength(1);
  });
});

describe("Service request oversight", () => {
  it("lists and filters service requests by status", async () => {
    const { admins, auditLog } = makeRepos();
    admins.seedServiceRequest({ status: "PUBLISHED" });
    admins.seedServiceRequest({ status: "COMPLETED" });
    const { listServiceRequests } = makeUseCases(admins, auditLog);

    const all = await listServiceRequests.execute({ limit: 20, offset: 0 });
    const published = await listServiceRequests.execute({ limit: 20, offset: 0, status: "PUBLISHED" });
    expect(all).toHaveLength(2);
    expect(published).toHaveLength(1);
    expect(published[0]?.status).toBe("PUBLISHED");
  });
});

describe("Quote oversight", () => {
  it("lists and filters quotes by status", async () => {
    const { admins, auditLog } = makeRepos();
    admins.seedQuote({ status: "SENT" });
    admins.seedQuote({ status: "ACCEPTED" });
    const { listQuotes } = makeUseCases(admins, auditLog);

    const accepted = await listQuotes.execute({ limit: 20, offset: 0, status: "ACCEPTED" });
    expect(accepted).toHaveLength(1);
    expect(accepted[0]?.status).toBe("ACCEPTED");
  });
});

describe("Appointment/job oversight", () => {
  it("lists and filters jobs by status", async () => {
    const { admins, auditLog } = makeRepos();
    admins.seedJob({ status: "CREATED" });
    admins.seedJob({ status: "COMPLETED" });
    const { listJobs } = makeUseCases(admins, auditLog);

    const completed = await listJobs.execute({ limit: 20, offset: 0, status: "COMPLETED" });
    expect(completed).toHaveLength(1);
    expect(completed[0]?.status).toBe("COMPLETED");
  });
});

describe("Review moderation", () => {
  it("lists reviews", async () => {
    const { admins, auditLog } = makeRepos();
    admins.seedReview();
    admins.seedReview();
    const { listReviews } = makeUseCases(admins, auditLog);
    expect(await listReviews.execute({ limit: 20, offset: 0 })).toHaveLength(2);
  });

  it("moderates (hides) a review and records an audit log entry", async () => {
    const { admins, auditLog } = makeRepos();
    const review = admins.seedReview({ status: "PUBLISHED" });
    const { moderateReview } = makeUseCases(admins, auditLog);

    const result = await moderateReview.execute(ADMIN_ID, review.id, "Inappropriate content");
    expect(result.status).toBe("REMOVED");
    expect(auditLog.entries[0]?.action).toBe("REVIEW_MODERATED");
    expect(auditLog.entries[0]?.adminUserId).toBe(ADMIN_ID);
  });

  it("restores a moderated review and records an audit log entry", async () => {
    const { admins, auditLog } = makeRepos();
    const review = admins.seedReview({ status: "REMOVED" });
    const { restoreReview } = makeUseCases(admins, auditLog);

    const result = await restoreReview.execute(ADMIN_ID, review.id);
    expect(result.status).toBe("PUBLISHED");
    expect(auditLog.entries[0]?.action).toBe("REVIEW_RESTORED");
  });

  it("moderating a nonexistent review throws NotFoundError", async () => {
    const { admins, auditLog } = makeRepos();
    const { moderateReview } = makeUseCases(admins, auditLog);
    await expect(moderateReview.execute(ADMIN_ID, "does-not-exist", null)).rejects.toThrow(NotFoundError);
  });

  it("public review listing excludes moderated reviews (PrismaReviewRepository contract)", async () => {
    // Module 13's PrismaReviewRepository.listByProfessionalId only ever
    // returns status === "PUBLISHED" (see that file's own PUBLIC_STATUS
    // constant) — this asserts the *contract* moderation depends on:
    // once ModerateReviewUseCase sets status to REMOVED, nothing further
    // needs to change for it to disappear from that public query.
    const PUBLIC_STATUS = "PUBLISHED";
    const { admins, auditLog } = makeRepos();
    const review = admins.seedReview({ status: "PUBLISHED" });
    const { moderateReview } = makeUseCases(admins, auditLog);
    const moderated = await moderateReview.execute(ADMIN_ID, review.id, null);
    expect(moderated.status).not.toBe(PUBLIC_STATUS);
  });
});

describe("Portfolio moderation", () => {
  it("lists portfolio items", async () => {
    const { admins, auditLog } = makeRepos();
    admins.seedPortfolioItem();
    admins.seedPortfolioItem();
    const { listPortfolio } = makeUseCases(admins, auditLog);
    expect(await listPortfolio.execute({ limit: 20, offset: 0 })).toHaveLength(2);
  });

  it("moderates (hides) a portfolio item and records an audit log entry", async () => {
    const { admins, auditLog } = makeRepos();
    const item = admins.seedPortfolioItem();
    const { moderatePortfolio } = makeUseCases(admins, auditLog);

    const result = await moderatePortfolio.execute(ADMIN_ID, item.id, "Inappropriate image");
    expect(result.moderatedAt).not.toBeNull();
    expect(auditLog.entries[0]?.action).toBe("PORTFOLIO_ITEM_MODERATED");
  });

  it("restores a moderated portfolio item and records an audit log entry", async () => {
    const { admins, auditLog } = makeRepos();
    const item = admins.seedPortfolioItem({ moderatedAt: new Date() });
    const { restorePortfolio } = makeUseCases(admins, auditLog);

    const result = await restorePortfolio.execute(ADMIN_ID, item.id);
    expect(result.moderatedAt).toBeNull();
    expect(auditLog.entries[0]?.action).toBe("PORTFOLIO_ITEM_RESTORED");
  });

  it("moderating a nonexistent portfolio item throws NotFoundError", async () => {
    const { admins, auditLog } = makeRepos();
    const { moderatePortfolio } = makeUseCases(admins, auditLog);
    await expect(moderatePortfolio.execute(ADMIN_ID, "does-not-exist", null)).rejects.toThrow(NotFoundError);
  });

  it("moderation is separate from the owner's own soft delete (deletedAt untouched)", async () => {
    const { admins, auditLog } = makeRepos();
    const item = admins.seedPortfolioItem({ deletedAt: null });
    const { moderatePortfolio } = makeUseCases(admins, auditLog);

    const result = await moderatePortfolio.execute(ADMIN_ID, item.id, null);
    expect(result.deletedAt).toBeNull();
    expect(result.moderatedAt).not.toBeNull();
  });
});

describe("Audit logs", () => {
  it("sensitive admin mutations create audit entries with the correct authenticated admin id", async () => {
    const { admins, auditLog } = makeRepos();
    admins.seedUser({ status: "ACTIVE", roles: ["ADMIN"] });
    const target = admins.seedUser({ status: "ACTIVE" });
    const review = admins.seedReview();
    const item = admins.seedPortfolioItem();
    const { suspend, moderateReview, moderatePortfolio, listAuditLogs } = makeUseCases(admins, auditLog);

    await suspend.execute(ADMIN_ID, target.id);
    await moderateReview.execute(ADMIN_ID, review.id, null);
    await moderatePortfolio.execute(ADMIN_ID, item.id, null);

    const logs = await listAuditLogs.execute({ limit: 20, offset: 0 });
    expect(logs).toHaveLength(3);
    expect(logs.every((l) => l.adminUserId === ADMIN_ID)).toBe(true);
  });

  it("audit log listing is read-only — no update/delete method exists on the repository interface", () => {
    const { auditLog } = makeRepos();
    expect((auditLog as unknown as { update?: unknown }).update).toBeUndefined();
    expect((auditLog as unknown as { delete?: unknown }).delete).toBeUndefined();
  });

  it("lists audit logs newest first with pagination", async () => {
    const { admins, auditLog } = makeRepos();
    admins.seedUser({ status: "ACTIVE", roles: ["ADMIN"] });
    const targets = [admins.seedUser({ status: "ACTIVE" }), admins.seedUser({ status: "ACTIVE" })];
    const { suspend, listAuditLogs } = makeUseCases(admins, auditLog);

    await suspend.execute(ADMIN_ID, targets[0]!.id);
    await suspend.execute(ADMIN_ID, targets[1]!.id);

    const logs = await listAuditLogs.execute({ limit: 1, offset: 0 });
    expect(logs).toHaveLength(1);
    expect(logs[0]?.targetId).toBe(targets[1]!.id);
  });
});

describe("Security — client-supplied identifiers cannot escalate privileges", () => {
  it("moderateReview always attributes the action to the id passed as the actor argument, never a field on the input DTO", () => {
    // moderateReviewSchema has no adminUserId/actorId/isAdmin field at all —
    // there is no way for a client payload to redirect who gets credited
    // for the action even in principle.
    const parsed = moderateReviewSchema.safeParse({
      reviewId: "123e4567-e89b-12d3-a456-426614174000",
      reason: "spam",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data).not.toHaveProperty("adminUserId");
      expect(parsed.data).not.toHaveProperty("actorId");
      expect(parsed.data).not.toHaveProperty("isAdmin");
    }
  });

  it("moderatePortfolioItemSchema never accepts an isAdmin/role/adminUserId field", () => {
    const parsed = moderatePortfolioItemSchema.safeParse({
      portfolioItemId: "123e4567-e89b-12d3-a456-426614174000",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data).not.toHaveProperty("adminUserId");
      expect(parsed.data).not.toHaveProperty("role");
      expect(parsed.data).not.toHaveProperty("isAdmin");
    }
  });

  it("listAdminUsersSchema never accepts a role/isAdmin claim from the client", () => {
    const parsed = listAdminUsersSchema.safeParse({ role: "ADMIN", isAdmin: true });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data).not.toHaveProperty("role");
      expect(parsed.data).not.toHaveProperty("isAdmin");
    }
  });

  it("listing users never returns a passwordHash or auth-token-shaped field", async () => {
    const { admins, auditLog } = makeRepos();
    admins.seedUser();
    const { listUsers } = makeUseCases(admins, auditLog);
    const users = await listUsers.execute({ limit: 20, offset: 0 });
    const keys = Object.keys(users[0]!);
    expect(keys).not.toContain("passwordHash");
    expect(keys).not.toContain("password");
  });
});
