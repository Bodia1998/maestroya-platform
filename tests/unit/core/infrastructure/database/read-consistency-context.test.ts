import { describe, expect, it } from "vitest";

import { getCurrentReadConsistency, withReadConsistency } from "@/infrastructure/database/read-consistency-context";

describe("infrastructure/database/read-consistency-context", () => {
  it("returns null outside of any withReadConsistency call", () => {
    expect(getCurrentReadConsistency()).toBeNull();
  });

  it("returns the active policy inside the callback", () => {
    withReadConsistency({ level: "STRONG", maxStalenessMs: 0 }, () => {
      expect(getCurrentReadConsistency()).toEqual({ level: "STRONG", maxStalenessMs: 0 });
    });
  });

  it("propagates through nested synchronous and asynchronous calls within the same callback", async () => {
    await withReadConsistency({ level: "BOUNDED_STALENESS", maxStalenessMs: 2000 }, async () => {
      await Promise.resolve();
      expect(getCurrentReadConsistency()).toEqual({ level: "BOUNDED_STALENESS", maxStalenessMs: 2000 });
    });
  });

  it("does not leak the policy outside the callback", async () => {
    await withReadConsistency({ level: "STRONG", maxStalenessMs: 0 }, async () => {
      await Promise.resolve();
    });
    expect(getCurrentReadConsistency()).toBeNull();
  });

  it("supports nested calls, restoring the outer policy after the inner one returns", () => {
    withReadConsistency({ level: "EVENTUAL", maxStalenessMs: 0 }, () => {
      withReadConsistency({ level: "STRONG", maxStalenessMs: 0 }, () => {
        expect(getCurrentReadConsistency()).toEqual({ level: "STRONG", maxStalenessMs: 0 });
      });
      expect(getCurrentReadConsistency()).toEqual({ level: "EVENTUAL", maxStalenessMs: 0 });
    });
  });

  it("returns whatever fn returns", () => {
    const result = withReadConsistency({ level: "EVENTUAL", maxStalenessMs: 0 }, () => 42);
    expect(result).toBe(42);
  });
});
