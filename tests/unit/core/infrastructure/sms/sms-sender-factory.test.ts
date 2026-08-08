import { afterEach, describe, expect, it, vi } from "vitest";

import { VALID_BASE_ENV } from "../config/env-fixture";

/**
 * `createSmsSender()` reads the module-level `env` singleton
 * (`infrastructure/config/env.ts`), which itself validates
 * `process.env` at import time — so, like `env.test.ts`, each case here
 * resets the module registry and re-imports under a controlled
 * `process.env`.
 */
async function loadFactoryWith(overrides: Record<string, string | undefined>) {
  const mutableEnv = process.env as Record<string, string | undefined>;
  for (const [key, value] of Object.entries({ ...VALID_BASE_ENV, ...overrides })) {
    if (value === undefined) delete mutableEnv[key];
    else mutableEnv[key] = value;
  }
  vi.resetModules();
  return import("@/infrastructure/sms/sms-sender-factory");
}

describe("createSmsSender", () => {
  afterEach(() => {
    for (const key of ["SMS_PROVIDER", "TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM_NUMBER"]) {
      delete (process.env as Record<string, string | undefined>)[key];
    }
    vi.resetModules();
  });

  it("returns a MockSmsSender for SMS_PROVIDER=mock (the default)", async () => {
    const { createSmsSender } = await loadFactoryWith({ SMS_PROVIDER: "mock" });
    const { MockSmsSender } = await import("@/infrastructure/sms/mock-sms-sender");
    expect(createSmsSender()).toBeInstanceOf(MockSmsSender);
  });

  it("returns a TwilioSmsSender for SMS_PROVIDER=twilio with complete credentials", async () => {
    const { createSmsSender } = await loadFactoryWith({
      SMS_PROVIDER: "twilio",
      TWILIO_ACCOUNT_SID: "ACxxx",
      TWILIO_AUTH_TOKEN: "token",
      TWILIO_FROM_NUMBER: "+15550001111",
    });
    const { TwilioSmsSender } = await import("@/infrastructure/sms/twilio-sms-sender");
    expect(createSmsSender()).toBeInstanceOf(TwilioSmsSender);
  });

  it("throws at construction time for SMS_PROVIDER=twilio missing any credential", async () => {
    const { createSmsSender } = await loadFactoryWith({
      SMS_PROVIDER: "twilio",
      TWILIO_ACCOUNT_SID: "ACxxx",
      // TWILIO_AUTH_TOKEN and TWILIO_FROM_NUMBER left unset.
    });
    expect(() => createSmsSender()).toThrow(/TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM_NUMBER/);
  });
});
