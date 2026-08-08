import { describe, expect, it } from "vitest";

import { collectTracingHealth, DISABLED_TRACING_HEALTH } from "@/infrastructure/tracing/tracing-health";

describe("infrastructure/tracing/tracing-health", () => {
  it("DISABLED_TRACING_HEALTH is the disabled, provider-less report", () => {
    expect(DISABLED_TRACING_HEALTH).toEqual({
      status: "disabled",
      enabled: false,
      provider: "none",
      exporter: "none",
      serviceName: "none",
    });
  });

  it("collectTracingHealth returns the disabled report when enabled: false, regardless of other inputs", () => {
    const report = collectTracingHealth({
      enabled: false,
      exporter: "otlp",
      serviceName: "maestroya-platform",
      started: true,
      failureReason: "should be ignored",
    });
    expect(report).toEqual(DISABLED_TRACING_HEALTH);
  });

  it("reports 'ok' when enabled and started with no failure", () => {
    const report = collectTracingHealth({
      enabled: true,
      exporter: "console",
      serviceName: "maestroya-platform",
      started: true,
      failureReason: null,
    });
    expect(report).toEqual({
      status: "ok",
      enabled: true,
      provider: "opentelemetry",
      exporter: "console",
      serviceName: "maestroya-platform",
    });
  });

  it("reports 'degraded' with a reason when the SDK failed to start", () => {
    const report = collectTracingHealth({
      enabled: true,
      exporter: "otlp",
      serviceName: "maestroya-platform",
      started: false,
      failureReason: "OTLP exporter package failed to load",
    });
    expect(report.status).toBe("degraded");
    expect(report.reason).toBe("OTLP exporter package failed to load");
  });

  it("reports 'degraded' with a generic reason when enabled but never started and no explicit failure was recorded", () => {
    const report = collectTracingHealth({
      enabled: true,
      exporter: "console",
      serviceName: "maestroya-platform",
      started: false,
      failureReason: null,
    });
    expect(report.status).toBe("degraded");
    expect(report.reason).toMatch(/not been started/i);
  });

  it("never throws for any combination of inputs", () => {
    expect(() =>
      collectTracingHealth({ enabled: true, exporter: "none", serviceName: "", started: true }),
    ).not.toThrow();
  });
});
