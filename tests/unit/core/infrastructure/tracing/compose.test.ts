import { afterEach, describe, expect, it, vi } from "vitest";

import { VALID_BASE_ENV } from "../config/env-fixture";

async function loadCompose(envOverrides: Record<string, string | undefined> = {}) {
  const mutableEnv = process.env as Record<string, string | undefined>;
  for (const [key, value] of Object.entries(VALID_BASE_ENV)) mutableEnv[key] = value;
  for (const [key, value] of Object.entries(envOverrides)) {
    if (value === undefined) delete mutableEnv[key];
    else mutableEnv[key] = value;
  }
  vi.resetModules();
  return import("@/infrastructure/tracing/compose");
}

describe("infrastructure/tracing/compose", () => {
  afterEach(() => {
    for (const key of ["TRACING_ENABLED", "TRACING_EXPORTER", "OTEL_SERVICE_NAME", "OTEL_EXPORTER_OTLP_ENDPOINT"]) {
      delete (process.env as Record<string, string | undefined>)[key];
    }
    vi.doUnmock("@/infrastructure/tracing/otel-sdk");
    vi.resetModules();
  });

  describe("disabled mode (TRACING_ENABLED unset — the default)", () => {
    it("isTracingEnabled() is false", async () => {
      const { isTracingEnabled } = await loadCompose();
      expect(isTracingEnabled()).toBe(false);
    });

    it("getTracer() returns the same disabled tracer every call, and it is a no-op", async () => {
      const { getTracer } = await loadCompose();
      const tracer = getTracer();
      expect(tracer.enabled).toBe(false);
      expect(getTracer()).toBe(tracer);
    });

    it("getTracingService() wraps the disabled tracer", async () => {
      const { getTracingService } = await loadCompose();
      expect(getTracingService().enabled).toBe(false);
    });

    it("startTracing() resolves immediately without importing the OpenTelemetry SDK module", async () => {
      vi.doMock("@/infrastructure/tracing/otel-sdk", () => {
        throw new Error("otel-sdk must never be imported when tracing is disabled");
      });
      const { startTracing } = await loadCompose();
      await expect(startTracing()).resolves.toBeUndefined();
    });

    it("shutdownTracing() is a safe no-op when the SDK was never started", async () => {
      const { shutdownTracing } = await loadCompose();
      await expect(shutdownTracing()).resolves.toBeUndefined();
    });

    it("getTracingHealth() reports 'disabled'", async () => {
      const { getTracingHealth } = await loadCompose();
      expect(getTracingHealth().status).toBe("disabled");
      expect(getTracingHealth().enabled).toBe(false);
    });
  });

  describe("enabled mode (TRACING_ENABLED=true)", () => {
    it("getTracer() returns an enabled OtelTracer", async () => {
      const { getTracer } = await loadCompose({ TRACING_ENABLED: "true" });
      expect(getTracer().enabled).toBe(true);
    });

    it("startTracing() boots the SDK, and getTracingHealth() reports 'ok' once started", async () => {
      const shutdown = vi.fn().mockResolvedValue(undefined);
      vi.doMock("@/infrastructure/tracing/otel-sdk", () => ({
        startOtelSdk: vi.fn(() => ({ shutdown, exporting: true })),
      }));

      const { startTracing, getTracingHealth, shutdownTracing } = await loadCompose({ TRACING_ENABLED: "true" });
      await startTracing();

      expect(getTracingHealth().status).toBe("ok");
      expect(getTracingHealth().provider).toBe("opentelemetry");

      await shutdownTracing();
      expect(shutdown).toHaveBeenCalledTimes(1);
    });

    it("startTracing() never throws when the SDK fails to start, and health degrades instead", async () => {
      vi.doMock("@/infrastructure/tracing/otel-sdk", () => ({
        startOtelSdk: vi.fn(() => {
          throw new Error("failed to construct exporter");
        }),
      }));

      const { startTracing, getTracingHealth } = await loadCompose({ TRACING_ENABLED: "true" });
      await expect(startTracing()).resolves.toBeUndefined();

      const health = getTracingHealth();
      expect(health.status).toBe("degraded");
      expect(health.reason).toMatch(/failed to construct exporter/);
    });

    it("startTracing() is idempotent — concurrent calls only boot the SDK once", async () => {
      const startOtelSdk = vi.fn(() => ({ shutdown: vi.fn().mockResolvedValue(undefined), exporting: true }));
      vi.doMock("@/infrastructure/tracing/otel-sdk", () => ({ startOtelSdk }));

      const { startTracing } = await loadCompose({ TRACING_ENABLED: "true" });
      await Promise.all([startTracing(), startTracing(), startTracing()]);

      expect(startOtelSdk).toHaveBeenCalledTimes(1);
    });
  });

  describe("__testing.reset()", () => {
    it("drops every singleton so the next call rebuilds (enabled mode — nullTracer is a shared singleton, so this is only observable with a real OtelTracer)", async () => {
      const { getTracer, __testing } = await loadCompose({ TRACING_ENABLED: "true" });
      const first = getTracer();
      __testing.reset();
      const second = getTracer();
      expect(second).not.toBe(first);
    });

    it("also clears the memoized config, so a reset can pick up an env change on next resolve", async () => {
      const { getTracer, __testing } = await loadCompose();
      getTracer(); // populates the memoized config as a side effect
      expect(__testing.config).not.toBeNull();
      __testing.reset();
      expect(__testing.config).toBeNull();
    });
  });
});
