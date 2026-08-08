import { describe, expect, it, vi } from "vitest";

import type { FeatureFlagDefinition } from "@/domain/entities/feature-flag";
import type {
  AdminAuditAction,
  AdminAuditLogRecord,
  AdminAuditLogRepository,
  ListAdminAuditLogsOptions,
  RecordAdminAuditLogData,
} from "@/domain/repositories/admin-audit-log-repository";
import type { FeatureFlagProvider } from "@/application/ports/feature-flag-provider";
import { FeatureFlagService } from "@/application/services/feature-flags/feature-flag-service";

class FakeFeatureFlagProvider implements FeatureFlagProvider {
  private readonly store = new Map<string, FeatureFlagDefinition>();

  constructor(seed: FeatureFlagDefinition[] = []) {
    for (const definition of seed) this.store.set(definition.key, definition);
  }

  async getDefinition(key: string): Promise<FeatureFlagDefinition | null> {
    return this.store.get(key) ?? null;
  }

  async listDefinitions(): Promise<FeatureFlagDefinition[]> {
    return Array.from(this.store.values());
  }

  async upsertDefinition(definition: FeatureFlagDefinition): Promise<FeatureFlagDefinition> {
    this.store.set(definition.key, definition);
    return definition;
  }
}

class FakeAdminAuditLogRepository implements AdminAuditLogRepository {
  entries: AdminAuditLogRecord[] = [];

  async record(data: RecordAdminAuditLogData): Promise<AdminAuditLogRecord> {
    const record: AdminAuditLogRecord = {
      id: `audit-${this.entries.length + 1}`,
      adminUserId: data.adminUserId,
      action: data.action as AdminAuditAction,
      targetType: data.targetType,
      targetId: data.targetId,
      metadata: data.metadata ?? null,
      createdAt: new Date(),
    };
    this.entries.push(record);
    return record;
  }

  async list(_options: ListAdminAuditLogsOptions): Promise<AdminAuditLogRecord[]> {
    return [...this.entries].reverse();
  }
}

function buildService(opts?: {
  seed?: FeatureFlagDefinition[];
  isGloballyDisabled?: () => boolean;
  provider?: FeatureFlagProvider;
}) {
  const provider = opts?.provider ?? new FakeFeatureFlagProvider(opts?.seed ?? []);
  const auditLog = new FakeAdminAuditLogRepository();
  const service = new FeatureFlagService(provider, auditLog, {
    isGloballyDisabled: opts?.isGloballyDisabled ?? (() => false),
    defaultEnvironment: () => "production",
  });
  return { service, provider, auditLog };
}

describe("application/services/feature-flags/feature-flag-service", () => {
  describe("evaluate", () => {
    it("returns UNKNOWN_FLAG (disabled) for a flag key that doesn't exist", async () => {
      const { service } = buildService();
      const result = await service.evaluate("does-not-exist", { userId: "u1" });
      expect(result).toEqual({ key: "does-not-exist", enabled: false, reason: "UNKNOWN_FLAG" });
    });

    it("returns GLOBAL_KILL_SWITCH (disabled) when the process-wide kill switch is on, even for a fully-enabled flag", async () => {
      const { service } = buildService({
        seed: [{ key: "flag", enabled: true }],
        isGloballyDisabled: () => true,
      });
      const result = await service.evaluate("flag", { userId: "u1" });
      expect(result.enabled).toBe(false);
      expect(result.reason).toBe("GLOBAL_KILL_SWITCH");
    });

    it("defaults the evaluation environment from the service's configured default when context omits it", async () => {
      const { service } = buildService({
        seed: [{ key: "flag", enabled: true, environments: ["production"] }],
      });
      const result = await service.evaluate("flag", { userId: "u1" });
      expect(result.enabled).toBe(true);
    });

    it("never throws — a provider error resolves to a disabled ERROR_FALLBACK result", async () => {
      const throwingProvider: FeatureFlagProvider = {
        getDefinition: vi.fn().mockRejectedValue(new Error("boom")),
        listDefinitions: vi.fn(),
        upsertDefinition: vi.fn(),
      };
      const { service } = buildService({ provider: throwingProvider });

      await expect(service.evaluate("flag", { userId: "u1" })).resolves.toEqual({
        key: "flag",
        enabled: false,
        reason: "ERROR_FALLBACK",
      });
    });

    it("delegates to the pure evaluator for a known, non-killswitched flag", async () => {
      const { service } = buildService({
        seed: [{ key: "flag", enabled: true, rollout: { percentage: 100 } }],
      });
      const result = await service.evaluate("flag", { userId: "u1" });
      expect(result.enabled).toBe(true);
      expect(result.reason).toBe("PERCENTAGE_ROLLOUT");
    });
  });

  describe("isEnabled", () => {
    it("returns just the boolean", async () => {
      const { service } = buildService({ seed: [{ key: "flag", enabled: true }] });
      await expect(service.isEnabled("flag", { userId: "u1" })).resolves.toBe(true);
    });
  });

  describe("listFlags / getFlag", () => {
    it("lists every known flag sorted by key", async () => {
      const { service } = buildService({
        seed: [
          { key: "zeta", enabled: true },
          { key: "alpha", enabled: true },
        ],
      });
      const flags = await service.listFlags();
      expect(flags.map((f) => f.key)).toEqual(["alpha", "zeta"]);
    });

    it("getFlag returns null for an unknown key", async () => {
      const { service } = buildService();
      await expect(service.getFlag("nope")).resolves.toBeNull();
    });
  });

  describe("updateFlag", () => {
    it("throws a ValidationError when creating a new flag without an explicit enabled value", async () => {
      const { service } = buildService();
      await expect(service.updateFlag("admin-1", "brand-new", { description: "x" })).rejects.toThrow(
        /explicit "enabled" value/,
      );
    });

    it("creates a new flag and records a FEATURE_FLAG_UPDATED audit entry", async () => {
      const { service, auditLog } = buildService();
      const created = await service.updateFlag("admin-1", "brand-new", { enabled: true });

      expect(created.key).toBe("brand-new");
      expect(created.enabled).toBe(true);
      expect(auditLog.entries).toHaveLength(1);
      expect(auditLog.entries[0]?.action).toBe("FEATURE_FLAG_UPDATED");
      expect(auditLog.entries[0]?.adminUserId).toBe("admin-1");
      expect(auditLog.entries[0]?.targetId).toBe("brand-new");
    });

    it("merges a partial patch onto the existing definition", async () => {
      const { service } = buildService({
        seed: [{ key: "flag", enabled: true, description: "original" }],
      });
      const updated = await service.updateFlag("admin-1", "flag", { rollout: { percentage: 50 } });

      expect(updated.description).toBe("original");
      expect(updated.rollout).toEqual({ percentage: 50 });
    });

    it("records FEATURE_FLAG_KILL_SWITCH_TOGGLED when killSwitch changes", async () => {
      const { service, auditLog } = buildService({
        seed: [{ key: "flag", enabled: true, killSwitch: false }],
      });
      await service.updateFlag("admin-1", "flag", { killSwitch: true });

      expect(auditLog.entries).toHaveLength(1);
      expect(auditLog.entries[0]?.action).toBe("FEATURE_FLAG_KILL_SWITCH_TOGGLED");
    });

    it("records FEATURE_FLAG_UPDATED (not the kill-switch action) when killSwitch is unchanged", async () => {
      const { service, auditLog } = buildService({
        seed: [{ key: "flag", enabled: true, killSwitch: false }],
      });
      await service.updateFlag("admin-1", "flag", { killSwitch: false, description: "tweak" });

      expect(auditLog.entries[0]?.action).toBe("FEATURE_FLAG_UPDATED");
    });

    it("supports a null adminUserId for system-triggered updates", async () => {
      const { service, auditLog } = buildService();
      await service.updateFlag(null, "system-flag", { enabled: false });
      expect(auditLog.entries[0]?.adminUserId).toBeNull();
    });
  });
});
