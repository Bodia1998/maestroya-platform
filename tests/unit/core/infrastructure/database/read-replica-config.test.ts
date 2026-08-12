import { afterEach, describe, expect, it, vi } from "vitest";

import { VALID_BASE_ENV } from "../config/env-fixture";
import { parseReplicaConnectionStrings } from "@/infrastructure/database/read-replica-config";

async function loadReplicaConfig(overrides: Record<string, string | undefined> = {}) {
  const mutableEnv = process.env as Record<string, string | undefined>;
  for (const [key, value] of Object.entries(VALID_BASE_ENV)) mutableEnv[key] = value;
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete mutableEnv[key];
    else mutableEnv[key] = value;
  }
  vi.resetModules();
  return import("@/infrastructure/database/read-replica-config");
}

const REPLICA_KEYS = [
  "READ_REPLICAS_ENABLED",
  "DATABASE_REPLICA_URLS",
  "READ_REPLICA_SELECTION_STRATEGY",
  "READ_REPLICA_DEFAULT_CONSISTENCY",
  "READ_REPLICA_MAX_STALENESS_MS",
  "READ_REPLICA_MAX_LAG_MS",
  "READ_REPLICA_FAILURE_THRESHOLD",
  "READ_REPLICA_RECOVERY_THRESHOLD",
  "READ_REPLICA_HEALTH_STALE_MS",
];

describe("infrastructure/database/read-replica-config", () => {
  afterEach(() => {
    for (const key of REPLICA_KEYS) delete (process.env as Record<string, string | undefined>)[key];
  });

  describe("resolveReadReplicaConfig", () => {
    it("is disabled by default, with no replicas", async () => {
      const { resolveReadReplicaConfig } = await loadReplicaConfig();
      const config = resolveReadReplicaConfig();
      expect(config.enabled).toBe(false);
      expect(config.replicas).toEqual([]);
    });

    it("stays disabled when READ_REPLICAS_ENABLED=true but no connection strings are provided", async () => {
      const { resolveReadReplicaConfig } = await loadReplicaConfig({ READ_REPLICAS_ENABLED: "true", DATABASE_REPLICA_URLS: "" });
      expect(resolveReadReplicaConfig().enabled).toBe(false);
    });

    it("enables and parses replicas when both are configured", async () => {
      const { resolveReadReplicaConfig } = await loadReplicaConfig({
        READ_REPLICAS_ENABLED: "true",
        DATABASE_REPLICA_URLS: "postgresql://a,postgresql://b",
      });
      const config = resolveReadReplicaConfig();
      expect(config.enabled).toBe(true);
      expect(config.replicas).toEqual([
        { replicaId: "replica-0", connectionString: "postgresql://a" },
        { replicaId: "replica-1", connectionString: "postgresql://b" },
      ]);
    });

    it("defaults to ROUND_ROBIN / EVENTUAL and falls back safely on an invalid selector", async () => {
      const { resolveReadReplicaConfig } = await loadReplicaConfig();
      const config = resolveReadReplicaConfig();
      expect(config.selectionStrategy).toBe("ROUND_ROBIN");
      expect(config.defaultConsistency.level).toBe("EVENTUAL");
    });

    it("an invalid READ_REPLICA_SELECTION_STRATEGY falls back to ROUND_ROBIN rather than failing startup", async () => {
      const { resolveReadReplicaConfig } = await loadReplicaConfig({ READ_REPLICA_SELECTION_STRATEGY: "not-a-real-strategy" });
      expect(resolveReadReplicaConfig().selectionStrategy).toBe("ROUND_ROBIN");
    });

    it("reads the threshold and staleness knobs from env", async () => {
      const { resolveReadReplicaConfig } = await loadReplicaConfig({
        READ_REPLICA_MAX_STALENESS_MS: "2000",
        READ_REPLICA_MAX_LAG_MS: "15000",
        READ_REPLICA_FAILURE_THRESHOLD: "5",
        READ_REPLICA_RECOVERY_THRESHOLD: "1",
        READ_REPLICA_HEALTH_STALE_MS: "45000",
      });
      const config = resolveReadReplicaConfig();
      expect(config.defaultConsistency.maxStalenessMs).toBe(2000);
      expect(config.thresholds.maxLagMs).toBe(15_000);
      expect(config.thresholds.failureThreshold).toBe(5);
      expect(config.thresholds.recoveryThreshold).toBe(1);
      expect(config.maxHealthAgeMs).toBe(45_000);
    });
  });

  describe("parseReplicaConnectionStrings", () => {
    it("returns [] for an empty string", () => {
      expect(parseReplicaConnectionStrings("")).toEqual([]);
    });

    it("splits on commas and trims whitespace", () => {
      expect(parseReplicaConnectionStrings(" postgresql://a , postgresql://b ")).toEqual(["postgresql://a", "postgresql://b"]);
    });

    it("drops blank entries from stray/trailing commas", () => {
      expect(parseReplicaConnectionStrings("postgresql://a,,postgresql://b,")).toEqual(["postgresql://a", "postgresql://b"]);
    });
  });
});
