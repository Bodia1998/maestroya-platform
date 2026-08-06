import { describe, expect, it, vi } from "vitest";

import { VALID_BASE_ENV } from "../config/env-fixture";

async function loadModule(sentryDsn: string | undefined) {
  const mutableEnv = process.env as Record<string, string | undefined>;
  for (const [key, value] of Object.entries(VALID_BASE_ENV)) mutableEnv[key] = value;
  if (sentryDsn === undefined) delete mutableEnv.SENTRY_DSN;
  else mutableEnv.SENTRY_DSN = sentryDsn;

  vi.resetModules();
  return Promise.all([
    import("@/infrastructure/observability/failure-reporter-factory"),
    import("@/infrastructure/observability/console-failure-reporter"),
    import("@/infrastructure/observability/sentry-failure-reporter"),
  ]);
}

describe("infrastructure/observability/failure-reporter-factory", () => {
  it("creates a ConsoleFailureReporter when SENTRY_DSN is unset (development)", async () => {
    const [{ createFailureReporter }, { ConsoleFailureReporter }] = await loadModule(undefined);
    expect(createFailureReporter()).toBeInstanceOf(ConsoleFailureReporter);
  });

  it("creates a SentryFailureReporter when SENTRY_DSN is set (production)", async () => {
    const [{ createFailureReporter }, , { SentryFailureReporter }] = await loadModule(
      "https://examplePublicKey@o0.ingest.sentry.io/0",
    );
    expect(createFailureReporter()).toBeInstanceOf(SentryFailureReporter);
  });

  it("memoizes a single instance per process", async () => {
    const [{ createFailureReporter }] = await loadModule(undefined);
    expect(createFailureReporter()).toBe(createFailureReporter());
  });
});
