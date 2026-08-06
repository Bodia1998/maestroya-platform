import { describe, expect, it, vi } from "vitest";

import { VALID_BASE_ENV } from "../config/env-fixture";

async function loadModule(sentryDsn: string | undefined) {
  const mutableEnv = process.env as Record<string, string | undefined>;
  for (const [key, value] of Object.entries(VALID_BASE_ENV)) mutableEnv[key] = value;
  if (sentryDsn === undefined) delete mutableEnv.SENTRY_DSN;
  else mutableEnv.SENTRY_DSN = sentryDsn;

  vi.resetModules();
  return Promise.all([
    import("@/infrastructure/observability/error-reporter-factory"),
    import("@/infrastructure/observability/console-error-reporter"),
    import("@/infrastructure/observability/sentry-error-reporter"),
  ]);
}

describe("infrastructure/observability/error-reporter-factory", () => {
  it("creates a ConsoleErrorReporter when SENTRY_DSN is unset", async () => {
    const [{ createErrorReporter }, { ConsoleErrorReporter }] = await loadModule(undefined);
    expect(createErrorReporter()).toBeInstanceOf(ConsoleErrorReporter);
  });

  it("creates a SentryErrorReporter when SENTRY_DSN is set", async () => {
    const [{ createErrorReporter }, , { SentryErrorReporter }] = await loadModule(
      "https://examplePublicKey@o0.ingest.sentry.io/0",
    );
    expect(createErrorReporter()).toBeInstanceOf(SentryErrorReporter);
  });

  it("memoizes a single instance per process", async () => {
    const [{ createErrorReporter }] = await loadModule(undefined);
    expect(createErrorReporter()).toBe(createErrorReporter());
  });
});
