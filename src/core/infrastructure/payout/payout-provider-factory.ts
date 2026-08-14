import "server-only";

import type { PayoutMethodValue } from "@/domain/services/professional-onboarding-rules";
import type { PayoutProvider } from "@/application/ports/payout-provider";
import { env } from "@/infrastructure/config/env";
import { IbanPayoutProvider } from "@/infrastructure/payout/iban-payout-provider";
import { StripeExpressPayoutProvider } from "@/infrastructure/payout/stripe-express-payout-provider";

/**
 * Module 62 — Professional Onboarding.
 *
 * The single place that resolves a `PayoutMethodValue` to a concrete
 * `PayoutProvider` — the same "one factory function, memoized instances"
 * shape as `verification-provider-factory.ts`/`search-provider-factory.ts`,
 * adapted for a method-keyed choice rather than an env-selected singleton
 * (a professional picks their own payout method; the process doesn't
 * choose one). Adding a third payout method later means one more adapter
 * and one more `case` here — no application use case changes (see
 * `PayoutProvider`'s own doc comment).
 */
const instances = new Map<PayoutMethodValue, PayoutProvider>();

export function getPayoutProvider(method: PayoutMethodValue): PayoutProvider {
  const existing = instances.get(method);
  if (existing) return existing;

  const provider = buildProvider(method);
  instances.set(method, provider);
  return provider;
}

function buildProvider(method: PayoutMethodValue): PayoutProvider {
  switch (method) {
    case "IBAN":
      return new IbanPayoutProvider(env.AUTH_SECRET);
    case "STRIPE_EXPRESS":
      return new StripeExpressPayoutProvider();
  }
}

/** Exposed for tests only — forces the next call to re-decide. */
export const __testing = {
  reset(): void {
    instances.clear();
  },
};
