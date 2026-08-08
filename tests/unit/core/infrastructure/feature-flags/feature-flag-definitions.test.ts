import { describe, expect, it, vi } from "vitest";

import { logger } from "@/infrastructure/observability/logger";
import {
  DEFAULT_FEATURE_FLAG_DEFINITIONS,
  mergeFeatureFlagDefinitions,
  parseFeatureFlagsConfig,
} from "@/infrastructure/feature-flags/feature-flag-definitions";

describe("infrastructure/feature-flags/feature-flag-definitions", () => {
  describe("DEFAULT_FEATURE_FLAG_DEFINITIONS", () => {
    it("has unique keys", () => {
      const keys = DEFAULT_FEATURE_FLAG_DEFINITIONS.map((d) => d.key);
      expect(new Set(keys).size).toBe(keys.length);
    });
  });

  describe("parseFeatureFlagsConfig", () => {
    it("returns an empty array for an undefined/empty value", () => {
      expect(parseFeatureFlagsConfig(undefined)).toEqual([]);
      expect(parseFeatureFlagsConfig("")).toEqual([]);
    });

    it("parses a valid JSON array of definitions", () => {
      const json = JSON.stringify([{ key: "flag-a", enabled: true, rollout: { percentage: 25 } }]);
      const result = parseFeatureFlagsConfig(json);
      expect(result).toEqual([{ key: "flag-a", enabled: true, rollout: { percentage: 25 } }]);
    });

    it("logs a warning and returns an empty array for malformed JSON, never throwing", () => {
      const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
      expect(() => parseFeatureFlagsConfig("{not valid json")).not.toThrow();
      expect(parseFeatureFlagsConfig("{not valid json")).toEqual([]);
      expect(warnSpy).toHaveBeenCalledWith("feature_flags.config_invalid_json", expect.anything());
      warnSpy.mockRestore();
    });

    it("logs a warning and returns an empty array for schema-invalid entries, never throwing", () => {
      const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
      const json = JSON.stringify([{ key: "flag-a" /* missing required "enabled" */ }]);
      expect(parseFeatureFlagsConfig(json)).toEqual([]);
      expect(warnSpy).toHaveBeenCalledWith("feature_flags.config_invalid_shape", expect.anything());
      warnSpy.mockRestore();
    });

    it("rejects an out-of-range rollout percentage", () => {
      const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
      const json = JSON.stringify([{ key: "flag-a", enabled: true, rollout: { percentage: 150 } }]);
      expect(parseFeatureFlagsConfig(json)).toEqual([]);
      warnSpy.mockRestore();
    });
  });

  describe("mergeFeatureFlagDefinitions", () => {
    it("keeps every default when there are no overrides", () => {
      const defaults = [{ key: "a", enabled: true }];
      expect(mergeFeatureFlagDefinitions(defaults, [])).toEqual(defaults);
    });

    it("an override entirely replaces the matching default (not a deep merge)", () => {
      const defaults = [{ key: "a", enabled: true, description: "default description" }];
      const overrides = [{ key: "a", enabled: false }];
      const merged = mergeFeatureFlagDefinitions(defaults, overrides);
      expect(merged).toEqual([{ key: "a", enabled: false }]);
    });

    it("adds an override whose key isn't in the defaults", () => {
      const defaults = [{ key: "a", enabled: true }];
      const overrides = [{ key: "b", enabled: false }];
      const merged = mergeFeatureFlagDefinitions(defaults, overrides);
      expect(merged.map((d) => d.key).sort()).toEqual(["a", "b"]);
    });
  });
});
