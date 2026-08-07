import { describe, expect, it, vi, beforeEach } from "vitest";

import { createCacheObserver } from "@/infrastructure/cache/cache-observability";
import { logger } from "@/infrastructure/observability/logger";
import { createErrorReporter } from "@/infrastructure/observability/error-reporter-factory";

const { mockReporter } = vi.hoisted(() => ({
  mockReporter: { reportException: vi.fn(), reportMessage: vi.fn() },
}));
vi.mock("@/infrastructure/observability/error-reporter-factory", () => ({
  createErrorReporter: vi.fn(() => mockReporter),
}));

describe("infrastructure/cache/cache-observability", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("onHit/onMiss/onSet/onDelete log at debug level (high-volume, gated in production)", () => {
    const debugSpy = vi.spyOn(logger, "debug").mockImplementation(() => undefined);
    const observer = createCacheObserver();

    observer.onHit({ namespace: "ns", key: "k" });
    observer.onMiss({ namespace: "ns", key: "k" });
    observer.onSet({ namespace: "ns", key: "k", ttlMs: 1000 });
    observer.onDelete({ namespace: "ns", key: "k" });

    expect(debugSpy).toHaveBeenCalledTimes(4);
    expect(debugSpy).toHaveBeenCalledWith("cache_hit", expect.objectContaining({ namespace: "ns", key: "k" }));
  });

  it("onInvalidate logs at info level", () => {
    const infoSpy = vi.spyOn(logger, "info").mockImplementation(() => undefined);
    const observer = createCacheObserver();

    observer.onInvalidate({ namespace: "ns", scope: "version", target: "cache:ns:v1:*", count: 3 });

    expect(infoSpy).toHaveBeenCalledWith(
      "cache_invalidated",
      expect.objectContaining({ namespace: "ns", scope: "version", count: 3 }),
    );
  });

  it("onError logs at warn level and reports through the existing ErrorReporter (Module 39)", () => {
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    const observer = createCacheObserver();
    const error = new Error("provider down");

    observer.onError({ operation: "get", namespace: "ns", key: "k", error });

    expect(warnSpy).toHaveBeenCalledWith("cache_operation_failed", expect.objectContaining({ operation: "get" }));
    expect(createErrorReporter).toHaveBeenCalled();
    expect(createErrorReporter().reportException).toHaveBeenCalledWith(
      error,
      expect.objectContaining({ tags: expect.objectContaining({ source: "caching-layer" }) }),
    );
  });
});
