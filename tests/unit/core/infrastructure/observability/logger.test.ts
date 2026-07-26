import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { VALID_BASE_ENV } from "../config/env-fixture";

/**
 * logger.ts imports env.ts, which validates `process.env` at import
 * time — every test in this file sets a valid base environment (via
 * `vi.resetModules()` + dynamic `import()`) before loading the logger,
 * same pattern as env.test.ts, rather than a static top-level import
 * (which Vitest would hoist above the `process.env` setup below).
 */
async function loadLogger(logLevel = "debug") {
  const mutableEnv = process.env as Record<string, string | undefined>;
  for (const [key, value] of Object.entries(VALID_BASE_ENV)) mutableEnv[key] = value;
  mutableEnv.LOG_LEVEL = logLevel;
  vi.resetModules();
  return import("@/infrastructure/observability/logger");
}

describe("infrastructure/observability/logger", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("emits structured JSON with timestamp, level, and event", async () => {
    const { logger } = await loadLogger("debug");
    logger.info("user_signed_in", { userId: "u_1" });

    expect(logSpy).toHaveBeenCalledTimes(1);
    const entry = JSON.parse(logSpy.mock.calls[0]![0] as string);
    expect(entry.level).toBe("info");
    expect(entry.event).toBe("user_signed_in");
    expect(entry.userId).toBe("u_1");
    expect(typeof entry.timestamp).toBe("string");
  });

  it("routes warn/error through console.error and debug/info through console.log", async () => {
    const { logger } = await loadLogger("debug");
    logger.debug("d", {});
    logger.info("i", {});
    logger.warn("w", {});
    logger.error("e", {});

    expect(logSpy).toHaveBeenCalledTimes(2);
    expect(errorSpy).toHaveBeenCalledTimes(2);
  });

  it("redacts fields whose key looks like a secret", async () => {
    const { logger } = await loadLogger("debug");
    logger.info("login_attempt", {
      email: "user@example.com",
      password: "hunter2",
      accessToken: "abc.def.ghi",
      nested: { refreshToken: "should-be-hidden", ok: true },
    });

    const entry = JSON.parse(logSpy.mock.calls[0]![0] as string);
    expect(entry.password).toBe("[REDACTED]");
    expect(entry.accessToken).toBe("[REDACTED]");
    expect(entry.nested.refreshToken).toBe("[REDACTED]");
    expect(entry.nested.ok).toBe(true);
    expect(entry.email).toBe("user@example.com");
  });

  it("includes requestId as a top-level field when provided", async () => {
    const { logger } = await loadLogger("debug");
    logger.info("event", { requestId: "req-123" });
    const entry = JSON.parse(logSpy.mock.calls[0]![0] as string);
    expect(entry.requestId).toBe("req-123");
  });

  it("suppresses log levels below the configured LOG_LEVEL threshold", async () => {
    const { logger } = await loadLogger("warn");
    logger.debug("d", {});
    logger.info("i", {});
    logger.warn("w", {});
    logger.error("e", {});

    expect(logSpy).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledTimes(2);
  });

  it("serializes Error instances without leaking a circular structure", async () => {
    const { logger } = await loadLogger("debug");
    const err = new Error("boom");
    logger.error("failure", { error: err });

    const entry = JSON.parse(errorSpy.mock.calls[0]![0] as string);
    expect(entry.error.message).toBe("boom");
    expect(entry.error.name).toBe("Error");
    expect(typeof entry.error.stack).toBe("string");
  });
});
