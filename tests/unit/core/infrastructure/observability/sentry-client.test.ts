import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { VALID_BASE_ENV } from "../config/env-fixture";

async function loadModule(sentryDsn: string | undefined) {
  const mutableEnv = process.env as Record<string, string | undefined>;
  for (const [key, value] of Object.entries(VALID_BASE_ENV)) mutableEnv[key] = value;
  if (sentryDsn === undefined) delete mutableEnv.SENTRY_DSN;
  else mutableEnv.SENTRY_DSN = sentryDsn;

  vi.resetModules();
  return import("@/infrastructure/observability/sentry-client");
}

describe("infrastructure/observability/sentry-client", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  it("reports not configured when SENTRY_DSN is unset", async () => {
    const { isSentryConfigured } = await loadModule(undefined);
    expect(isSentryConfigured()).toBe(false);
  });

  it("reports configured when SENTRY_DSN is set", async () => {
    const { isSentryConfigured } = await loadModule("https://examplePublicKey@o0.ingest.sentry.io/0");
    expect(isSentryConfigured()).toBe(true);
  });

  it("getSentry() resolves to null without configuration, never attempting to load the SDK", async () => {
    const { getSentry } = await loadModule(undefined);
    await expect(getSentry()).resolves.toBeNull();
  });

  it("getSentry() degrades to null (never throws) when the SDK fails to initialize", async () => {
    // `@sentry/nextjs` is a real installed dependency, so simulate the
    // failure directly — `Sentry.init` throwing (a bad DSN, a network
    // configuration problem, etc.) — rather than relying on the package
    // being absent. This is exactly the resilience path `sentry-client.ts`
    // exists to guarantee: a broken Sentry init must never crash the app
    // or reject unhandled.
    vi.doMock("@sentry/nextjs", () => ({
      init: () => {
        throw new Error("simulated Sentry init failure");
      },
    }));

    const { getSentry } = await loadModule("https://examplePublicKey@o0.ingest.sentry.io/0");
    await expect(getSentry()).resolves.toBeNull();

    vi.doUnmock("@sentry/nextjs");
  });
});
