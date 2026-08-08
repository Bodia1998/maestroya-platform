import { describe, expect, it } from "vitest";

import type { FeatureFlagDefinition } from "@/domain/entities/feature-flag";
import { evaluateFeatureFlag } from "@/domain/services/feature-flag-evaluator";

function baseDefinition(overrides: Partial<FeatureFlagDefinition> = {}): FeatureFlagDefinition {
  return { key: "my-flag", enabled: true, ...overrides };
}

describe("domain/services/feature-flag-evaluator", () => {
  it("returns disabled with FLAG_KILL_SWITCH when the flag's own kill switch is set, even if otherwise fully enabled", () => {
    const definition = baseDefinition({ killSwitch: true, rollout: { percentage: 100 } });
    const result = evaluateFeatureFlag(definition, { userId: "u1" });
    expect(result).toEqual({ key: "my-flag", enabled: false, reason: "FLAG_KILL_SWITCH" });
  });

  it("returns disabled with FLAG_DISABLED when enabled is false", () => {
    const definition = baseDefinition({ enabled: false });
    const result = evaluateFeatureFlag(definition, {});
    expect(result.enabled).toBe(false);
    expect(result.reason).toBe("FLAG_DISABLED");
  });

  describe("environment scoping", () => {
    it("disables the flag outside its configured environments", () => {
      const definition = baseDefinition({ environments: ["production"] });
      const result = evaluateFeatureFlag(definition, { environment: "development" });
      expect(result.enabled).toBe(false);
      expect(result.reason).toBe("ENVIRONMENT_SCOPED");
    });

    it("disables the flag when no environment is present in context but the flag is scoped", () => {
      const definition = baseDefinition({ environments: ["production"] });
      const result = evaluateFeatureFlag(definition, {});
      expect(result.enabled).toBe(false);
      expect(result.reason).toBe("ENVIRONMENT_SCOPED");
    });

    it("allows the flag inside its configured environment", () => {
      const definition = baseDefinition({ environments: ["production", "development"] });
      const result = evaluateFeatureFlag(definition, { environment: "production" });
      expect(result.enabled).toBe(true);
    });

    it("applies to every environment when environments is unset", () => {
      const definition = baseDefinition();
      const result = evaluateFeatureFlag(definition, { environment: "production" });
      expect(result.enabled).toBe(true);
    });
  });

  describe("user targeting", () => {
    it("deny list takes precedence over allow list for the same user", () => {
      const definition = baseDefinition({
        targeting: { userAllowList: ["u1"], userDenyList: ["u1"] },
      });
      const result = evaluateFeatureFlag(definition, { userId: "u1" });
      expect(result.enabled).toBe(false);
      expect(result.reason).toBe("USER_DENY_LIST");
    });

    it("deny list disables even when the base flag is enabled with no rollout", () => {
      const definition = baseDefinition({ targeting: { userDenyList: ["u1"] } });
      const result = evaluateFeatureFlag(definition, { userId: "u1" });
      expect(result.enabled).toBe(false);
      expect(result.reason).toBe("USER_DENY_LIST");
    });

    it("allow list enables a user regardless of rollout percentage", () => {
      const definition = baseDefinition({
        rollout: { percentage: 0 },
        targeting: { userAllowList: ["u1"] },
      });
      const result = evaluateFeatureFlag(definition, { userId: "u1" });
      expect(result.enabled).toBe(true);
      expect(result.reason).toBe("USER_ALLOW_LIST");
    });

    it("a user not on any list falls through to rollout/default behaviour", () => {
      const definition = baseDefinition({ targeting: { userAllowList: ["someone-else"] } });
      const result = evaluateFeatureFlag(definition, { userId: "u1" });
      expect(result.reason).toBe("DEFAULT_ENABLED");
    });
  });

  describe("role targeting", () => {
    it("enables the flag for a user holding a targeted role", () => {
      const definition = baseDefinition({
        rollout: { percentage: 0 },
        targeting: { roleAllowList: ["ADMIN"] },
      });
      const result = evaluateFeatureFlag(definition, { userId: "u1", roles: ["CUSTOMER", "ADMIN"] });
      expect(result.enabled).toBe(true);
      expect(result.reason).toBe("ROLE_TARGETED");
    });

    it("does not enable the flag for a user without any targeted role", () => {
      const definition = baseDefinition({
        rollout: { percentage: 0 },
        targeting: { roleAllowList: ["ADMIN"] },
      });
      const result = evaluateFeatureFlag(definition, { userId: "u1", roles: ["CUSTOMER"] });
      expect(result.enabled).toBe(false);
    });

    it("treats a missing roles array as no roles, not a match", () => {
      const definition = baseDefinition({
        rollout: { percentage: 0 },
        targeting: { roleAllowList: ["ADMIN"] },
      });
      const result = evaluateFeatureFlag(definition, { userId: "u1" });
      expect(result.enabled).toBe(false);
    });
  });

  describe("percentage rollout", () => {
    it("is deterministic for the same user across repeated evaluations", () => {
      const definition = baseDefinition({ rollout: { percentage: 50 } });
      const first = evaluateFeatureFlag(definition, { userId: "stable-user" });
      const second = evaluateFeatureFlag(definition, { userId: "stable-user" });
      expect(first).toEqual(second);
    });

    it("fails closed (disabled) when no userId is present to hash on", () => {
      const definition = baseDefinition({ rollout: { percentage: 100 } });
      const result = evaluateFeatureFlag(definition, {});
      expect(result.enabled).toBe(false);
      expect(result.reason).toBe("PERCENTAGE_ROLLOUT");
    });

    it("100% rollout enables every user", () => {
      const definition = baseDefinition({ rollout: { percentage: 100 } });
      for (let i = 0; i < 20; i += 1) {
        expect(evaluateFeatureFlag(definition, { userId: `u${i}` }).enabled).toBe(true);
      }
    });

    it("0% rollout disables every user", () => {
      const definition = baseDefinition({ rollout: { percentage: 0 } });
      for (let i = 0; i < 20; i += 1) {
        expect(evaluateFeatureFlag(definition, { userId: `u${i}` }).enabled).toBe(false);
      }
    });
  });

  describe("default fallback", () => {
    it("enables an unconditionally-enabled flag with no rollout/targeting for anyone", () => {
      const definition = baseDefinition();
      const result = evaluateFeatureFlag(definition, { userId: "anyone" });
      expect(result.enabled).toBe(true);
      expect(result.reason).toBe("DEFAULT_ENABLED");
    });
  });

  describe("variants", () => {
    it("resolves a variant when the flag is enabled and variants are configured", () => {
      const definition = baseDefinition({
        variants: [
          { name: "control", weight: 1 },
          { name: "treatment", weight: 1 },
        ],
      });
      const result = evaluateFeatureFlag(definition, { userId: "u1" });
      expect(result.enabled).toBe(true);
      expect(["control", "treatment"]).toContain(result.variant);
    });

    it("never assigns a variant when the flag is disabled", () => {
      const definition = baseDefinition({
        enabled: false,
        variants: [{ name: "control", weight: 1 }],
      });
      const result = evaluateFeatureFlag(definition, { userId: "u1" });
      expect(result.variant).toBeUndefined();
    });
  });
});
