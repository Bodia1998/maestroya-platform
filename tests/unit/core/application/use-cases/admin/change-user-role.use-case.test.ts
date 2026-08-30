import { beforeEach, describe, expect, it } from "vitest";

import { ChangeUserRoleUseCase } from "@/application/use-cases/admin/change-user-role.use-case";
import { ConflictError, UnauthorizedError } from "@/domain/errors/domain-error";
import { FakeAdminAuditLogRepository, FakeAdminRepository } from "../../../../../integration/admin/fakes";
import { FakeSecurityEventRepository } from "../../../../../integration/security/fakes";

/**
 * Module 82 — Admin RBAC & Production Auth Hardening (finding B1): unit
 * coverage for the five privilege-escalation cases the audit named, plus a
 * regression check that the pre-existing last-active-admin protection
 * still behaves exactly as before. Real `ChangeUserRoleUseCase` +
 * in-memory fakes (same convention as tests/integration/admin/
 * admin-flows.test.ts) so this exercises the actual authorization logic,
 * not a mocked stand-in for it.
 */
function setup() {
  const admins = new FakeAdminRepository();
  const auditLog = new FakeAdminAuditLogRepository();
  const securityEvents = new FakeSecurityEventRepository();
  const useCase = new ChangeUserRoleUseCase(admins, auditLog, securityEvents);
  return { admins, auditLog, securityEvents, useCase };
}

describe("ChangeUserRoleUseCase — ADMIN privilege escalation (Module 82, finding B1)", () => {
  let ctx: ReturnType<typeof setup>;

  beforeEach(() => {
    ctx = setup();
  });

  it("Case 1 — ADMIN caller granting ADMIN to another user is REJECTED", async () => {
    const { admins, useCase, securityEvents } = ctx;
    const caller = admins.seedUser({ status: "ACTIVE", roles: ["ADMIN"] });
    const target = admins.seedUser({ status: "ACTIVE", roles: ["CUSTOMER"] });

    await expect(useCase.execute(caller.id, target.id, ["ADMIN"])).rejects.toBeInstanceOf(UnauthorizedError);

    // Target's roles must be unchanged.
    expect((await admins.getUserById(target.id))?.roles).toEqual(["CUSTOMER"]);
    // Denial is recorded on the security event trail.
    expect(securityEvents.events).toHaveLength(1);
    expect(securityEvents.events[0]?.type).toBe("SECURITY_POLICY_BLOCKED");
    expect(securityEvents.events[0]?.userId).toBe(caller.id);
  });

  it("Case 2 — ADMIN caller granting SUPER_ADMIN to another user is REJECTED", async () => {
    const { admins, useCase } = ctx;
    const caller = admins.seedUser({ status: "ACTIVE", roles: ["ADMIN"] });
    const target = admins.seedUser({ status: "ACTIVE", roles: ["CUSTOMER"] });

    await expect(useCase.execute(caller.id, target.id, ["SUPER_ADMIN"])).rejects.toBeInstanceOf(UnauthorizedError);
    expect((await admins.getUserById(target.id))?.roles).toEqual(["CUSTOMER"]);
  });

  it("Case 3 — ADMIN caller self-promoting to ADMIN/SUPER_ADMIN is REJECTED", async () => {
    const { admins, useCase } = ctx;
    const caller = admins.seedUser({ status: "ACTIVE", roles: ["ADMIN"] });

    await expect(useCase.execute(caller.id, caller.id, ["ADMIN", "SUPER_ADMIN"])).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
    expect((await admins.getUserById(caller.id))?.roles).toEqual(["ADMIN"]);
  });

  it("Case 4 — SUPER_ADMIN caller granting ADMIN to another user is ALLOWED", async () => {
    const { admins, useCase, auditLog } = ctx;
    const caller = admins.seedUser({ status: "ACTIVE", roles: ["SUPER_ADMIN"] });
    const target = admins.seedUser({ status: "ACTIVE", roles: ["CUSTOMER"] });

    const result = await useCase.execute(caller.id, target.id, ["ADMIN"]);
    expect(result.roles).toEqual(["ADMIN"]);
    expect(auditLog.entries[0]?.action).toBe("USER_ROLE_CHANGED");
  });

  it("Case 5 — SUPER_ADMIN caller granting SUPER_ADMIN to another user is ALLOWED", async () => {
    const { admins, useCase } = ctx;
    const caller = admins.seedUser({ status: "ACTIVE", roles: ["SUPER_ADMIN"] });
    const target = admins.seedUser({ status: "ACTIVE", roles: ["CUSTOMER"] });

    const result = await useCase.execute(caller.id, target.id, ["SUPER_ADMIN"]);
    expect(result.roles).toEqual(["SUPER_ADMIN"]);
  });

  it("a SUPER_ADMIN can also grant SUPER_ADMIN to themselves (not treated as an escalation)", async () => {
    const { admins, useCase } = ctx;
    const caller = admins.seedUser({ status: "ACTIVE", roles: ["SUPER_ADMIN"] });

    const result = await useCase.execute(caller.id, caller.id, ["SUPER_ADMIN"]);
    expect(result.roles).toEqual(["SUPER_ADMIN"]);
  });

  it("a demoted/suspended caller (fresh DB read shows no SUPER_ADMIN) cannot grant ADMIN even if invoked with their old id", async () => {
    const { admins, useCase } = ctx;
    // Caller's *current* DB record is a plain ADMIN — regardless of what
    // any calling layer might have believed about them.
    const caller = admins.seedUser({ status: "ACTIVE", roles: ["ADMIN"] });
    const target = admins.seedUser({ status: "ACTIVE", roles: ["CUSTOMER"] });

    await expect(useCase.execute(caller.id, target.id, ["ADMIN"])).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("regression: last-active-admin protection still rejects removing the only remaining admin's admin role", async () => {
    const { admins, useCase } = ctx;
    const onlyAdmin = admins.seedUser({ status: "ACTIVE", roles: ["ADMIN"] });

    await expect(useCase.execute(onlyAdmin.id, onlyAdmin.id, ["CUSTOMER"])).rejects.toBeInstanceOf(ConflictError);
  });

  it("regression: last-active-admin protection allows removing admin role when another active admin remains", async () => {
    const { admins, useCase } = ctx;
    const superAdmin = admins.seedUser({ status: "ACTIVE", roles: ["SUPER_ADMIN"] });
    const otherAdmin = admins.seedUser({ status: "ACTIVE", roles: ["ADMIN"] });

    const result = await useCase.execute(superAdmin.id, otherAdmin.id, ["CUSTOMER"]);
    expect(result.roles).toEqual(["CUSTOMER"]);
  });

  it("regression: unknown role keys are still rejected with ValidationError before any RBAC check runs", async () => {
    const { admins, useCase } = ctx;
    const caller = admins.seedUser({ status: "ACTIVE", roles: ["ADMIN"] });
    const target = admins.seedUser({ status: "ACTIVE", roles: ["CUSTOMER"] });

    await expect(useCase.execute(caller.id, target.id, ["NOT_A_REAL_ROLE"])).rejects.toThrow();
  });
});
