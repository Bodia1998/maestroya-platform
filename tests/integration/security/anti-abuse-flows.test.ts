import { beforeEach, describe, expect, it, vi } from "vitest";

import { AntiAbuseService } from "@/application/services/anti-abuse-service";
import { CreateAccountRestrictionUseCase } from "@/application/use-cases/security/create-account-restriction.use-case";
import { LiftAccountRestrictionUseCase } from "@/application/use-cases/security/lift-account-restriction.use-case";
import { ListAccountRestrictionsUseCase } from "@/application/use-cases/security/list-account-restrictions.use-case";
import { ListSecurityEventsUseCase } from "@/application/use-cases/security/list-security-events.use-case";
import { AccountRestrictedError, NotFoundError, RateLimitedError, ValidationError } from "@/domain/errors/domain-error";
import { InMemoryRateLimitRepository } from "@/infrastructure/security/in-memory-rate-limit-repository";
import { FakeAccountRestrictionRepository, FakeSecurityEventRepository } from "./fakes";

// Same convention as tests/integration/admin/admin-flows.test.ts: mock the
// NextAuth wrapper module-level, before any import that transitively pulls
// in next-auth, so the Server Action auth boundary itself is exercised.
vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

// Module 82 — Admin RBAC & Production Auth Hardening: requireRole() now
// re-verifies status/roles fresh from the DB for admin-tier checks
// (SUPER_ADMIN included — see rbac.ts's own doc comment), so this file's
// direct requireRole(ROLES.SUPER_ADMIN) calls below need PrismaUserRepository
// mocked too, same "mock one collaborator" convention as
// tests/unit/core/infrastructure/auth/rbac.test.ts. `vi.hoisted()` because
// this file's own static imports above transitively resolve rbac.ts first.
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
const { requireRole, ROLES } = await import("@/infrastructure/auth/rbac");
const mockedAuth = vi.mocked(auth);

function makeService() {
  const rateLimits = new InMemoryRateLimitRepository();
  const securityEvents = new FakeSecurityEventRepository();
  const restrictions = new FakeAccountRestrictionRepository();
  const service = new AntiAbuseService(rateLimits, securityEvents, restrictions);
  return { service, rateLimits, securityEvents, restrictions };
}

describe("AntiAbuseService.enforceRateLimit", () => {
  it("allows attempts under the configured limit", async () => {
    const { service } = makeService();
    for (let i = 0; i < 5; i++) {
      await expect(
        service.enforceRateLimit("LOGIN_BY_EMAIL", { resource: "a@example.com" }, "RATE_LIMIT_TRIGGERED"),
      ).resolves.toBeUndefined();
    }
  });

  it("throws RateLimitedError once the limit is exceeded", async () => {
    const { service } = makeService();
    for (let i = 0; i < 5; i++) {
      await service.enforceRateLimit("LOGIN_BY_EMAIL", { resource: "a@example.com" }, "RATE_LIMIT_TRIGGERED");
    }
    await expect(
      service.enforceRateLimit("LOGIN_BY_EMAIL", { resource: "a@example.com" }, "RATE_LIMIT_TRIGGERED"),
    ).rejects.toThrow(RateLimitedError);
  });

  it("records a SecurityEvent only on the blocked attempt, never on allowed ones", async () => {
    const { service, securityEvents } = makeService();
    for (let i = 0; i < 5; i++) {
      await service.enforceRateLimit("LOGIN_BY_EMAIL", { resource: "b@example.com" }, "RATE_LIMIT_TRIGGERED");
    }
    expect(securityEvents.events).toHaveLength(0);

    await expect(
      service.enforceRateLimit("LOGIN_BY_EMAIL", { resource: "b@example.com" }, "RATE_LIMIT_TRIGGERED"),
    ).rejects.toThrow(RateLimitedError);
    expect(securityEvents.events).toHaveLength(1);
    expect(securityEvents.events[0]!.type).toBe("RATE_LIMIT_TRIGGERED");
  });

  it("keeps separate budgets for different identities under the same policy (no cross-user bleed)", async () => {
    const { service } = makeService();
    for (let i = 0; i < 5; i++) {
      await service.enforceRateLimit("LOGIN_BY_EMAIL", { resource: "user-a@example.com" }, "RATE_LIMIT_TRIGGERED");
    }
    // A different identity under the same policy must still be allowed —
    // this is also the "client can't bypass rate limits via a different
    // resource id" security-regression check, read the other direction
    // (an unrelated identity is *not* incorrectly blocked by someone
    // else's usage).
    await expect(
      service.enforceRateLimit("LOGIN_BY_EMAIL", { resource: "user-b@example.com" }, "RATE_LIMIT_TRIGGERED"),
    ).resolves.toBeUndefined();
  });

  it("keeps separate budgets for the same identity under different policies (no cross-policy bleed)", async () => {
    const { service } = makeService();
    for (let i = 0; i < 5; i++) {
      await service.enforceRateLimit("LOGIN_BY_EMAIL", { resource: "shared@example.com" }, "RATE_LIMIT_TRIGGERED");
    }
    await expect(
      service.enforceRateLimit(
        "PASSWORD_RESET_REQUEST_BY_EMAIL",
        { resource: "shared@example.com" },
        "RATE_LIMIT_TRIGGERED",
      ),
    ).resolves.toBeUndefined();
  });
});

describe("AntiAbuseService.escalateToTemporaryBlock", () => {
  it("creates an auto-expiring TEMPORARILY_BLOCKED restriction with no admin actor", async () => {
    const { service, restrictions } = makeService();
    const now = new Date("2026-01-01T00:00:00.000Z");
    await service.escalateToTemporaryBlock("user-1", { reason: "FAILED_LOGIN_BURST", durationMs: 60_000 }, now);

    expect(restrictions.restrictions).toHaveLength(1);
    const restriction = restrictions.restrictions[0]!;
    expect(restriction.state).toBe("TEMPORARILY_BLOCKED");
    expect(restriction.createdByUserId).toBeNull();
    expect(restriction.expiresAt).toEqual(new Date(now.getTime() + 60_000));
  });

  it("blocks the user until expiry, then auto-lifts (no longer active) without any manual action", async () => {
    const { service } = makeService();
    const now = new Date("2026-01-01T00:00:00.000Z");
    await service.escalateToTemporaryBlock("user-1", { reason: "FAILED_LOGIN_BURST", durationMs: 60_000 }, now);

    await expect(service.assertNotBlocked("user-1", new Date(now.getTime() + 30_000))).rejects.toThrow(
      AccountRestrictedError,
    );
    await expect(service.assertNotBlocked("user-1", new Date(now.getTime() + 60_001))).resolves.toBeUndefined();
  });
});

describe("AntiAbuseService.isDuplicateContent / isBelowMinimumInterval", () => {
  it("flags exact and near-duplicate content", () => {
    const { service } = makeService();
    expect(service.isDuplicateContent("Hello there!", ["hello there!"])).toBe(true);
    expect(service.isDuplicateContent("Something new", ["hello there!"])).toBe(false);
  });

  it("flags an action below the configured minimum interval", () => {
    const { service } = makeService();
    const now = new Date("2026-01-01T00:01:00.000Z");
    const last = new Date(now.getTime() - 5_000);
    expect(service.isBelowMinimumInterval(last, 60_000, now)).toBe(true);
    expect(service.isBelowMinimumInterval(new Date(now.getTime() - 61_000), 60_000, now)).toBe(false);
  });
});

describe("Account restriction admin use cases", () => {
  const ADMIN_ID = "admin-1";
  const TARGET_USER_ID = "user-1";

  function makeUseCases() {
    const securityEvents = new FakeSecurityEventRepository();
    const restrictions = new FakeAccountRestrictionRepository();
    return {
      securityEvents,
      restrictions,
      create: new CreateAccountRestrictionUseCase(restrictions, securityEvents),
      lift: new LiftAccountRestrictionUseCase(restrictions, securityEvents),
      list: new ListAccountRestrictionsUseCase(restrictions),
      listEvents: new ListSecurityEventsUseCase(securityEvents),
    };
  }

  it("an admin can create an explicit, indefinite restriction (expiresAt=null allowed only here)", async () => {
    const { create, restrictions } = makeUseCases();
    const restriction = await create.execute(ADMIN_ID, {
      userId: TARGET_USER_ID,
      state: "TEMPORARILY_BLOCKED",
      reason: "ADMIN_DECISION",
    });
    expect(restriction.expiresAt).toBeNull();
    expect(restriction.createdByUserId).toBe(ADMIN_ID);
    expect(restrictions.restrictions).toHaveLength(1);
  });

  it("rejects an admin restricting their own account", async () => {
    const { create } = makeUseCases();
    await expect(
      create.execute(ADMIN_ID, { userId: ADMIN_ID, state: "FLAGGED", reason: "ADMIN_DECISION" }),
    ).rejects.toThrow(ValidationError);
  });

  it("records an ADMIN_ACTION security event on create and lift", async () => {
    const { create, lift, securityEvents } = makeUseCases();
    const restriction = await create.execute(ADMIN_ID, {
      userId: TARGET_USER_ID,
      state: "THROTTLED",
      reason: "MESSAGE_SPAM",
      durationMinutes: 30,
    });
    await lift.execute(ADMIN_ID, restriction.id);

    const adminEvents = securityEvents.events.filter((e) => e.type === "ADMIN_ACTION");
    expect(adminEvents).toHaveLength(2);
    expect(adminEvents[0]!.metadata?.adminAction).toBe("ACCOUNT_RESTRICTION_CREATED");
    expect(adminEvents[1]!.metadata?.adminAction).toBe("ACCOUNT_RESTRICTION_LIFTED");
  });

  it("lifting an unknown restriction throws NotFoundError", async () => {
    const { lift } = makeUseCases();
    await expect(lift.execute(ADMIN_ID, "does-not-exist")).rejects.toThrow(NotFoundError);
  });

  it("a lifted restriction is no longer active", async () => {
    const { create, lift, restrictions } = makeUseCases();
    const restriction = await create.execute(ADMIN_ID, {
      userId: TARGET_USER_ID,
      state: "TEMPORARILY_BLOCKED",
      reason: "ADMIN_DECISION",
    });
    await lift.execute(ADMIN_ID, restriction.id);

    const active = await restrictions.findActiveForUser(TARGET_USER_ID, new Date());
    expect(active).toBeNull();
  });
});

describe("Security regression: admin-only read access", () => {
  beforeEach(() => {
    mockedAuth.mockReset();
    mockUsers.findById.mockReset();
    mockUsers.getRoleKeys.mockReset();
  });

  it("a non-admin (customer) cannot pass the SUPER_ADMIN gate used by security admin actions", async () => {
    mockedAuth.mockResolvedValue({
      user: { id: "customer-1", email: "c@example.com", roles: ["CUSTOMER"] },
    } as never);
    await expect(requireRole(ROLES.SUPER_ADMIN)).rejects.toThrow();
  });

  it("a regular ADMIN (not SUPER_ADMIN) cannot pass the security module's stricter gate", async () => {
    mockedAuth.mockResolvedValue({
      user: { id: "admin-1", email: "a@example.com", roles: ["ADMIN"] },
    } as never);
    await expect(requireRole(ROLES.SUPER_ADMIN)).rejects.toThrow();
  });

  it("a SUPER_ADMIN passes the gate", async () => {
    mockedAuth.mockResolvedValue({
      user: { id: "super-1", email: "s@example.com", roles: ["SUPER_ADMIN"] },
    } as never);
    mockUsers.findById.mockResolvedValue({ id: "super-1", status: "ACTIVE" });
    mockUsers.getRoleKeys.mockResolvedValue(["SUPER_ADMIN"]);
    const user = await requireRole(ROLES.SUPER_ADMIN);
    expect(user.id).toBe("super-1");
  });
});
