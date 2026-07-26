import { describe, expect, it } from "vitest";

import {
  isHardBlocked,
  isRestrictionActive,
  mostSevereActiveRestriction,
} from "@/domain/services/account-restriction-rules";
import type { AccountRestrictionRecord } from "@/domain/repositories/account-restriction-repository";

const now = new Date("2026-01-01T00:00:00.000Z");

function makeRestriction(overrides: Partial<AccountRestrictionRecord> = {}): AccountRestrictionRecord {
  return {
    id: overrides.id ?? "r1",
    userId: "user-1",
    state: "FLAGGED",
    reason: "OTHER",
    notes: null,
    createdByUserId: null,
    expiresAt: null,
    liftedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("account-restriction-rules: isRestrictionActive", () => {
  it("is active with no expiry and no lift", () => {
    expect(isRestrictionActive(makeRestriction(), now)).toBe(true);
  });

  it("is inactive once lifted, regardless of expiry", () => {
    expect(isRestrictionActive(makeRestriction({ liftedAt: now }), now)).toBe(false);
  });

  it("is inactive once expired", () => {
    const past = new Date(now.getTime() - 1000);
    expect(isRestrictionActive(makeRestriction({ expiresAt: past }), now)).toBe(false);
  });

  it("is active when expiresAt is still in the future", () => {
    const future = new Date(now.getTime() + 1000);
    expect(isRestrictionActive(makeRestriction({ expiresAt: future }), now)).toBe(true);
  });
});

describe("account-restriction-rules: mostSevereActiveRestriction", () => {
  it("returns null for an empty list", () => {
    expect(mostSevereActiveRestriction([], now)).toBeNull();
  });

  it("ignores lifted/expired restrictions", () => {
    const lifted = makeRestriction({ id: "r1", state: "TEMPORARILY_BLOCKED", liftedAt: now });
    expect(mostSevereActiveRestriction([lifted], now)).toBeNull();
  });

  it("picks TEMPORARILY_BLOCKED over THROTTLED and FLAGGED", () => {
    const flagged = makeRestriction({ id: "r1", state: "FLAGGED" });
    const throttled = makeRestriction({ id: "r2", state: "THROTTLED" });
    const blocked = makeRestriction({ id: "r3", state: "TEMPORARILY_BLOCKED" });
    const result = mostSevereActiveRestriction([flagged, throttled, blocked], now);
    expect(result?.id).toBe("r3");
  });

  it("picks THROTTLED over FLAGGED when no block is present", () => {
    const flagged = makeRestriction({ id: "r1", state: "FLAGGED" });
    const throttled = makeRestriction({ id: "r2", state: "THROTTLED" });
    const result = mostSevereActiveRestriction([flagged, throttled], now);
    expect(result?.id).toBe("r2");
  });
});

describe("account-restriction-rules: isHardBlocked", () => {
  it("is false for null", () => {
    expect(isHardBlocked(null)).toBe(false);
  });

  it("is true only for TEMPORARILY_BLOCKED", () => {
    expect(isHardBlocked(makeRestriction({ state: "TEMPORARILY_BLOCKED" }))).toBe(true);
    expect(isHardBlocked(makeRestriction({ state: "THROTTLED" }))).toBe(false);
    expect(isHardBlocked(makeRestriction({ state: "FLAGGED" }))).toBe(false);
  });
});
