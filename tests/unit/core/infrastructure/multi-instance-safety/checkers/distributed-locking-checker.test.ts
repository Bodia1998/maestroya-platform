import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DistributedLockingChecker } from "@/infrastructure/multi-instance-safety/checkers/distributed-locking-checker";
import { SourceScanner } from "@/infrastructure/multi-instance-safety/source-scanner";

const REDIS_LOCK_PATH = "src/core/infrastructure/locking/redis-lock-service.ts";
const FACTORY_PATH = "src/core/infrastructure/locking/lock-service-factory.ts";
const IN_MEMORY_PATH = "src/core/infrastructure/locking/in-memory-lock-service.ts";

const SAFE_REDIS_LOCK_SOURCE = `
export class RedisLockService {
  async withLock(key, ttlMs, fn) {
    if (ttlMs <= 0) throw new RangeError("bad ttl");
    const acquired = await this.client.command(["SET", key, "token", "PX", ttlMs, "NX"]);
    if (acquired !== "OK") return null;
    try { return await fn(); }
    finally { await this.client.command(["EVAL", "if redis.call('GET', KEYS[1]) == ARGV[1] then", "1", key, "token"]); }
  }
}
`;

const SAFE_FACTORY_SOURCE = `
import { getRedisClient } from "@/infrastructure/cache/redis-client-factory";
import { RedisLockService } from "@/infrastructure/locking/redis-lock-service";
export function createLockService() {
  const redisClient = getRedisClient();
  return redisClient ? new RedisLockService(redisClient) : new InMemoryLockService();
}
`;

async function writeFixture(dir: string, relativePath: string, content: string): Promise<void> {
  const fullPath = path.join(dir, relativePath);
  await mkdir(path.dirname(fullPath), { recursive: true });
  await writeFile(fullPath, content, "utf8");
}

describe("infrastructure/multi-instance-safety/checkers/distributed-locking-checker — DistributedLockingChecker", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "m58-lock-checker-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("reports only passed checks (plus the documented in-memory-fallback warning) when every safe pattern is present", async () => {
    await writeFixture(dir, REDIS_LOCK_PATH, SAFE_REDIS_LOCK_SOURCE);
    await writeFixture(dir, FACTORY_PATH, SAFE_FACTORY_SOURCE);
    await writeFixture(dir, IN_MEMORY_PATH, "export class InMemoryLockService {}");

    const checker = new DistributedLockingChecker(new SourceScanner(dir));
    const outcome = await checker.check();

    expect(outcome.passedChecks.length).toBeGreaterThan(0);
    // The in-memory fallback existing is always flagged as a WARNING (informational), even in the safe case.
    expect(outcome.findings).toHaveLength(1);
    expect(outcome.findings[0]!.severity).toBe("WARNING");
  });

  it("reports a CRITICAL finding when the Redis lock file is missing entirely", async () => {
    const checker = new DistributedLockingChecker(new SourceScanner(dir));
    const outcome = await checker.check();

    expect(outcome.findings.some((f) => f.severity === "CRITICAL")).toBe(true);
  });

  it("reports a HIGH-priority WARNING when the release script does not check the ownership token", async () => {
    await writeFixture(
      dir,
      REDIS_LOCK_PATH,
      `export class RedisLockService { async withLock(key, ttlMs, fn) { if (ttlMs <= 0) throw new RangeError(); await this.client.command(["SET", key, "t", "PX", ttlMs, "NX"]); return fn(); } }`,
    );
    await writeFixture(dir, FACTORY_PATH, SAFE_FACTORY_SOURCE);

    const checker = new DistributedLockingChecker(new SourceScanner(dir));
    const outcome = await checker.check();

    const releaseFinding = outcome.findings.find((f) => f.problem.includes("release"));
    expect(releaseFinding).toBeDefined();
    expect(releaseFinding!.priority).toBe("HIGH");
  });
});
