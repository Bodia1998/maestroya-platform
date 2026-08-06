import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { VALID_BASE_ENV } from "../config/env-fixture";

/**
 * `@sentry/nextjs` is a real installed dependency, so these tests
 * simulate the SDK failing to initialize (`Sentry.init` throwing) rather
 * than relying on the package being absent — see `sentry-client.test.ts`'s
 * equivalent fix for the same reasoning. This exercises
 * `SentryErrorReporter`'s fallback path: when the SDK can't be reached,
 * every report must still be captured (via the structured logger) rather
 * than silently dropped, and `report*` must never throw. That fallback
 * behavior is exactly what makes this reporter safe to wire in
 * unconditionally once `SENTRY_DSN` is set, even in an environment where
 * the SDK's own initialization turns out to be broken.
 */
function mockFailingSentrySdk() {
  vi.doMock("@sentry/nextjs", () => ({
    init: () => {
      throw new Error("simulated Sentry init failure");
    },
  }));
}

async function loadReporter() {
  const mutableEnv = process.env as Record<string, string | undefined>;
  for (const [key, value] of Object.entries(VALID_BASE_ENV)) mutableEnv[key] = value;
  mutableEnv.SENTRY_DSN = "https://examplePublicKey@o0.ingest.sentry.io/0";

  vi.resetModules();
  const { SentryErrorReporter } = await import("@/infrastructure/observability/sentry-error-reporter");
  return new SentryErrorReporter();
}

describe("infrastructure/observability/sentry-error-reporter", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    errorSpy.mockRestore();
    vi.doUnmock("@sentry/nextjs");
  });

  it("reportException never throws, even when the Sentry SDK is unavailable", async () => {
    mockFailingSentrySdk();
    const reporter = await loadReporter();
    expect(() =>
      reporter.reportException(new Error("boom"), { tags: { route: "/api/test" } }),
    ).not.toThrow();
  });

  it("reportMessage never throws, even when the Sentry SDK is unavailable", async () => {
    mockFailingSentrySdk();
    const reporter = await loadReporter();
    expect(() => reporter.reportMessage("diagnostic note")).not.toThrow();
  });

  it("falls back to the structured logger when Sentry can't be reached", async () => {
    mockFailingSentrySdk();
    const reporter = await loadReporter();
    reporter.reportException(new Error("boom"));

    // The async fallback is fire-and-forget from reportException's
    // perspective; give the microtask queue a turn to run it.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(errorSpy).toHaveBeenCalled();
    const loggedLines = errorSpy.mock.calls.map((call) => JSON.parse(call[0] as string));
    expect(loggedLines.some((entry) => entry.event === "error-reporter.exception")).toBe(true);
  });
});
