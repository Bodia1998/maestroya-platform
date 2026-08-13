import { describe, expect, it } from "vitest";

import {
  mapProviderOutcomeToCaseStatus,
  resolveProviderStatusTransition,
} from "@/domain/services/verification-provider-outcome";

describe("verification-provider-outcome (Module 59)", () => {
  describe("mapProviderOutcomeToCaseStatus", () => {
    it("maps decisive outcomes to a case status", () => {
      expect(mapProviderOutcomeToCaseStatus("VERIFIED")).toBe("APPROVED");
      expect(mapProviderOutcomeToCaseStatus("REJECTED")).toBe("REJECTED");
      expect(mapProviderOutcomeToCaseStatus("EXPIRED")).toBe("EXPIRED");
      expect(mapProviderOutcomeToCaseStatus("NEEDS_REVIEW")).toBe("UNDER_REVIEW");
    });

    it("returns null for outcomes that never change status by themselves", () => {
      expect(mapProviderOutcomeToCaseStatus("NOT_STARTED")).toBeNull();
      expect(mapProviderOutcomeToCaseStatus("PENDING")).toBeNull();
      expect(mapProviderOutcomeToCaseStatus("IN_PROGRESS")).toBeNull();
      expect(mapProviderOutcomeToCaseStatus("ERROR")).toBeNull();
    });
  });

  describe("resolveProviderStatusTransition", () => {
    it("applies a legal transition", () => {
      expect(resolveProviderStatusTransition("PENDING", "VERIFIED")).toBe("APPROVED");
      expect(resolveProviderStatusTransition("PENDING", "REJECTED")).toBe("REJECTED");
      expect(resolveProviderStatusTransition("PENDING", "NEEDS_REVIEW")).toBe("UNDER_REVIEW");
      expect(resolveProviderStatusTransition("UNDER_REVIEW", "VERIFIED")).toBe("APPROVED");
    });

    it("returns null when the outcome doesn't map to a status change", () => {
      expect(resolveProviderStatusTransition("PENDING", "PENDING")).toBeNull();
      expect(resolveProviderStatusTransition("PENDING", "IN_PROGRESS")).toBeNull();
      expect(resolveProviderStatusTransition("PENDING", "ERROR")).toBeNull();
    });

    it("returns null when the mapped status equals the current status", () => {
      expect(resolveProviderStatusTransition("UNDER_REVIEW", "NEEDS_REVIEW")).toBeNull();
    });

    it("returns null when the transition would be illegal even though the outcome is decisive", () => {
      // APPROVED has no legal transition to REJECTED (only -> EXPIRED).
      expect(resolveProviderStatusTransition("APPROVED", "REJECTED")).toBeNull();
      // EXPIRED is terminal.
      expect(resolveProviderStatusTransition("EXPIRED", "VERIFIED")).toBeNull();
    });
  });
});
