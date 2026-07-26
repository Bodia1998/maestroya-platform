import { describe, expect, it } from "vitest";

import { toAdminAccountRestrictionView, toAdminSecurityEventView } from "@/application/dto/security.dto";
import type { SecurityEventRecord } from "@/domain/repositories/security-event-repository";
import type { AccountRestrictionRecord } from "@/domain/repositories/account-restriction-repository";

describe("security.dto: toAdminSecurityEventView", () => {
  it("never includes ipHash, even for an authorized admin view", () => {
    const record: SecurityEventRecord = {
      id: "event-1",
      type: "LOGIN_FAILED",
      userId: "user-1",
      ipHash: "some-hash-that-must-never-leak",
      userAgent: "Mozilla/5.0",
      metadata: { policy: "LOGIN_BY_EMAIL" },
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    };

    const view = toAdminSecurityEventView(record);
    expect(view).not.toHaveProperty("ipHash");
    expect(JSON.stringify(view)).not.toContain("some-hash-that-must-never-leak");
  });
});

describe("security.dto: toAdminAccountRestrictionView", () => {
  it("carries the internal reason/notes through for an admin (they are allowed to see it)", () => {
    const record: AccountRestrictionRecord = {
      id: "restriction-1",
      userId: "user-1",
      state: "TEMPORARILY_BLOCKED",
      reason: "FAILED_LOGIN_BURST",
      notes: "auto-created after repeated breaches",
      createdByUserId: null,
      expiresAt: new Date("2026-01-01T01:00:00.000Z"),
      liftedAt: null,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    };

    const view = toAdminAccountRestrictionView(record);
    expect(view.reason).toBe("FAILED_LOGIN_BURST");
    expect(view.notes).toBe("auto-created after repeated breaches");
  });
});
