import "server-only";

import type { VerificationProvider } from "@/application/ports/verification-provider";
import { env } from "@/infrastructure/config/env";
import { logger } from "@/infrastructure/observability/logger";
import { NullVerificationProvider } from "@/infrastructure/verification/null-verification-provider";
import { PersonaClient } from "@/infrastructure/verification/persona-client";
import { PersonaVerificationProvider } from "@/infrastructure/verification/persona-verification-provider";

/**
 * Module 59 — Professional Verification (Persona).
 *
 * The single place that decides which `VerificationProvider` a process
 * gets — the same memoized-factory shape as
 * `search-provider-factory.ts`/`geocoding-provider-factory.ts`/
 * `job-store-factory.ts`: one instance per process, chosen from the
 * validated env, with a `__testing.reset()` so a test can force the
 * decision to be re-made.
 *
 * ## Fallback, never failure
 * `VERIFICATION_PROVIDER=persona` with missing `PERSONA_API_KEY`/
 * `PERSONA_TEMPLATE_ID` falls back to `NullVerificationProvider` with a
 * warning rather than throwing at construction time — the same rule
 * `search-provider-factory.ts` follows for a misconfigured search engine.
 * The Module 17 manual workflow never depends on this factory at all, so
 * a half-configured Persona setup degrades to "automated verification is
 * unavailable, manual review still works," never a broken deployment.
 * (Production deployments that deliberately select `persona` still fail
 * fast at `env.ts`'s own startup validation — see that file's
 * `.superRefine` block — this fallback only covers a process that somehow
 * reaches here with an invalid combination anyway, e.g. a non-production
 * environment.)
 */
let instance: VerificationProvider | null = null;

export function createVerificationProvider(): VerificationProvider {
  if (!instance) instance = buildProvider();
  return instance;
}

function buildProvider(): VerificationProvider {
  if (env.VERIFICATION_PROVIDER !== "persona") {
    return new NullVerificationProvider();
  }

  if (!env.PERSONA_API_KEY || !env.PERSONA_TEMPLATE_ID) {
    logger.warn("verification_provider_misconfigured", {
      provider: "persona",
      reason: "PERSONA_API_KEY/PERSONA_TEMPLATE_ID are not set — falling back to the manual-only verification provider.",
    });
    return new NullVerificationProvider();
  }

  const client = new PersonaClient({
    apiKey: env.PERSONA_API_KEY,
    baseUrl: env.PERSONA_API_BASE_URL,
  });

  return new PersonaVerificationProvider({
    client,
    templateId: env.PERSONA_TEMPLATE_ID,
    webhookSecret: env.PERSONA_WEBHOOK_SECRET,
  });
}

/** Exposed for tests only — forces the next call to re-decide. */
export const __testing = {
  reset(): void {
    instance = null;
  },
};
