import { afterEach, describe, expect, it, vi } from "vitest";

import { VALID_BASE_ENV } from "../config/env-fixture";
import { parseExporterHeaders } from "@/infrastructure/tracing/tracing-config";

async function loadTracingConfig(overrides: Record<string, string | undefined> = {}) {
  const mutableEnv = process.env as Record<string, string | undefined>;
  for (const [key, value] of Object.entries(VALID_BASE_ENV)) mutableEnv[key] = value;
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete mutableEnv[key];
    else mutableEnv[key] = value;
  }
  vi.resetModules();
  return import("@/infrastructure/tracing/tracing-config");
}

describe("infrastructure/tracing/tracing-config", () => {
  afterEach(() => {
    for (const key of ["TRACING_ENABLED", "TRACING_EXPORTER", "OTEL_SERVICE_NAME", "OTEL_EXPORTER_OTLP_ENDPOINT", "OTEL_EXPORTER_HEADERS"]) {
      delete (process.env as Record<string, string | undefined>)[key];
    }
  });

  describe("resolveTracingConfig", () => {
    it("is disabled by default, with exporter 'console' and the default service name", async () => {
      const { resolveTracingConfig, DEFAULT_TRACING_SERVICE_NAME } = await loadTracingConfig();
      const config = resolveTracingConfig();
      expect(config.enabled).toBe(false);
      expect(config.exporter).toBe("console");
      expect(config.serviceName).toBe(DEFAULT_TRACING_SERVICE_NAME);
      expect(config.endpoint).toBeNull();
      expect(config.headers).toEqual({});
    });

    it("enabled: true only when TRACING_ENABLED === 'true'", async () => {
      const { resolveTracingConfig: resolved1 } = await loadTracingConfig({ TRACING_ENABLED: "false" });
      expect(resolved1().enabled).toBe(false);

      const { resolveTracingConfig: resolved2 } = await loadTracingConfig({ TRACING_ENABLED: "true" });
      expect(resolved2().enabled).toBe(true);
    });

    it("uses OTEL_SERVICE_NAME when provided", async () => {
      const { resolveTracingConfig } = await loadTracingConfig({ OTEL_SERVICE_NAME: "custom-service" });
      expect(resolveTracingConfig().serviceName).toBe("custom-service");
    });

    it("downgrades exporter 'otlp' with no endpoint to 'none' rather than building a broken exporter", async () => {
      const { resolveTracingConfig } = await loadTracingConfig({
        TRACING_ENABLED: "true",
        TRACING_EXPORTER: "otlp",
        OTEL_EXPORTER_OTLP_ENDPOINT: undefined,
      });
      expect(resolveTracingConfig().exporter).toBe("none");
    });

    it("keeps exporter 'otlp' when an endpoint is present", async () => {
      const { resolveTracingConfig } = await loadTracingConfig({
        TRACING_ENABLED: "true",
        TRACING_EXPORTER: "otlp",
        OTEL_EXPORTER_OTLP_ENDPOINT: "http://localhost:4318/v1/traces",
      });
      const config = resolveTracingConfig();
      expect(config.exporter).toBe("otlp");
      expect(config.endpoint).toBe("http://localhost:4318/v1/traces");
    });

    it("an invalid TRACING_EXPORTER value falls back to 'console' rather than failing startup", async () => {
      const { resolveTracingConfig } = await loadTracingConfig({ TRACING_EXPORTER: "not-a-real-exporter" });
      expect(resolveTracingConfig().exporter).toBe("console");
    });

    it("parses OTEL_EXPORTER_HEADERS into the resolved config", async () => {
      const { resolveTracingConfig } = await loadTracingConfig({
        OTEL_EXPORTER_HEADERS: "x-api-key=abc,x-tenant=maestroya",
      });
      expect(resolveTracingConfig().headers).toEqual({ "x-api-key": "abc", "x-tenant": "maestroya" });
    });
  });

  describe("parseExporterHeaders", () => {
    it("returns {} for undefined/null/empty input", () => {
      expect(parseExporterHeaders(undefined)).toEqual({});
      expect(parseExporterHeaders(null)).toEqual({});
      expect(parseExporterHeaders("")).toEqual({});
    });

    it("parses comma-separated key=value pairs", () => {
      expect(parseExporterHeaders("x-api-key=abc,x-tenant=maestroya")).toEqual({
        "x-api-key": "abc",
        "x-tenant": "maestroya",
      });
    });

    it("trims whitespace around keys and values", () => {
      expect(parseExporterHeaders(" x-api-key = abc , x-tenant = maestroya ")).toEqual({
        "x-api-key": "abc",
        "x-tenant": "maestroya",
      });
    });

    it("skips malformed entries (no '=', empty key) rather than throwing", () => {
      expect(parseExporterHeaders("no-equals-sign,=empty-key,valid=1")).toEqual({ valid: "1" });
    });

    it("allows an empty value", () => {
      expect(parseExporterHeaders("key=")).toEqual({ key: "" });
    });
  });
});
