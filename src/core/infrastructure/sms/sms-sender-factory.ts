import "server-only";

import type { SmsSender } from "@/application/interfaces/sms-sender";
import { env } from "@/infrastructure/config/env";
import { MockSmsSender } from "@/infrastructure/sms/mock-sms-sender";
import { TwilioSmsSender } from "@/infrastructure/sms/twilio-sms-sender";
import { createTracedFetch } from "@/infrastructure/tracing/traced-fetch";

/**
 * Module 49 — SMS Notifications.
 *
 * Selects the `SmsSender` implementation from `env.SMS_PROVIDER`, mirroring
 * `createSearchProvider()`/`createGeocodingProvider()`'s exact "read the
 * validated env, switch, never throw for the default path" shape (Module
 * 47 / Module 27) rather than the unconditional single-implementation
 * wiring email currently has (`ResendEmailSender` constructed directly in
 * every `compose.ts`) — SMS has two real, swappable backends from day one,
 * so it gets the swappable-factory treatment those other provider-backed
 * modules already established.
 *
 * `mock` (the default — see `env.ts`) never throws and never makes a
 * network call, so every environment that hasn't deliberately configured
 * Twilio keeps working. Selecting `twilio` without complete credentials is
 * the one case this factory does throw for — a deployment that opted into
 * a real provider and is missing what it needs to actually use it should
 * fail loudly at construction time, not silently degrade to no-op sends
 * that look successful. (Production additionally fails at `env.ts`'s own
 * startup validation before this is ever reached — see that file's
 * `.superRefine`.)
 */
export function createSmsSender(): SmsSender {
  switch (env.SMS_PROVIDER) {
    case "twilio": {
      if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN || !env.TWILIO_FROM_NUMBER) {
        throw new Error(
          "SMS_PROVIDER=twilio requires TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM_NUMBER to be set.",
        );
      }
      // Module 51 — Distributed Tracing: `TwilioSmsSender`'s existing
      // injectable `fetchImpl` seam is the instrumentation point — a
      // traced `fetch` gives both a `client` span for the Twilio call and
      // W3C trace-context propagation on the wire, neither of which a
      // decorator around `SmsSender` could provide. `createTracedFetch`
      // returns the global `fetch` unchanged when tracing is disabled, so
      // the sender is constructed exactly as it was before.
      return new TwilioSmsSender(
        env.TWILIO_ACCOUNT_SID,
        env.TWILIO_AUTH_TOKEN,
        env.TWILIO_FROM_NUMBER,
        createTracedFetch("twilio"),
      );
    }
    case "mock":
    default:
      return new MockSmsSender();
  }
}
