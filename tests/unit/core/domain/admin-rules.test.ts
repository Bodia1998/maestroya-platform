import { describe, expect, it } from "vitest";

import {
  isReactivatableStatus,
  isSuspendableStatus,
  normalizeModerationReason,
} from "@/domain/services/admin-rules";

describe("isSuspendableStatus", () => {
  it("allows suspending an ACTIVE user", () => {
    expect(isSuspendableStatus("ACTIVE")).toBe(true);
  });

  it("rejects suspending a user who is already SUSPENDED", () => {
    expect(isSuspendableStatus("SUSPENDED")).toBe(false);
  });

  it("rejects suspending a BANNED or DEACTIVATED or PENDING_VERIFICATION user", () => {
    expect(isSuspendableStatus("BANNED")).toBe(false);
    expect(isSuspendableStatus("DEACTIVATED")).toBe(false);
    expect(isSuspendableStatus("PENDING_VERIFICATION")).toBe(false);
  });
});

describe("isReactivatableStatus", () => {
  it("allows reactivating a SUSPENDED user", () => {
    expect(isReactivatableStatus("SUSPENDED")).toBe(true);
  });

  it("allows reactivating a DEACTIVATED user", () => {
    expect(isReactivatableStatus("DEACTIVATED")).toBe(true);
  });

  it("rejects reactivating an already-ACTIVE user", () => {
    expect(isReactivatableStatus("ACTIVE")).toBe(false);
  });

  it("rejects reactivating a BANNED user (deliberately out of scope)", () => {
    expect(isReactivatableStatus("BANNED")).toBe(false);
  });
});

describe("normalizeModerationReason", () => {
  it("trims surrounding whitespace", () => {
    expect(normalizeModerationReason("  spam content  ")).toBe("spam content");
  });

  it("collapses a whitespace-only string to null", () => {
    expect(normalizeModerationReason("   ")).toBeNull();
  });

  it("collapses an empty string to null", () => {
    expect(normalizeModerationReason("")).toBeNull();
  });

  it("passes through null and undefined as null", () => {
    expect(normalizeModerationReason(null)).toBeNull();
    expect(normalizeModerationReason(undefined)).toBeNull();
  });
});
