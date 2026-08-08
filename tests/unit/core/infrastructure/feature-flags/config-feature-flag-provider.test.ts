import { describe, expect, it } from "vitest";

import { ConfigFeatureFlagProvider } from "@/infrastructure/feature-flags/config-feature-flag-provider";

describe("infrastructure/feature-flags/config-feature-flag-provider", () => {
  it("getDefinition returns null for an unseeded key", async () => {
    const provider = new ConfigFeatureFlagProvider();
    await expect(provider.getDefinition("nope")).resolves.toBeNull();
  });

  it("getDefinition returns a seeded definition", async () => {
    const provider = new ConfigFeatureFlagProvider([{ key: "flag", enabled: true }]);
    await expect(provider.getDefinition("flag")).resolves.toEqual({ key: "flag", enabled: true });
  });

  it("listDefinitions returns every seeded definition", async () => {
    const provider = new ConfigFeatureFlagProvider([
      { key: "a", enabled: true },
      { key: "b", enabled: false },
    ]);
    const all = await provider.listDefinitions();
    expect(all.map((d) => d.key).sort()).toEqual(["a", "b"]);
  });

  it("upsertDefinition creates a new definition", async () => {
    const provider = new ConfigFeatureFlagProvider();
    await provider.upsertDefinition({ key: "new", enabled: true });
    await expect(provider.getDefinition("new")).resolves.toEqual({ key: "new", enabled: true });
  });

  it("upsertDefinition replaces an existing definition entirely", async () => {
    const provider = new ConfigFeatureFlagProvider([
      { key: "flag", enabled: true, description: "old" },
    ]);
    await provider.upsertDefinition({ key: "flag", enabled: false });
    await expect(provider.getDefinition("flag")).resolves.toEqual({ key: "flag", enabled: false });
  });
});
