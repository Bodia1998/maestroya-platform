import { PrismaExternalWebhookEventRepository } from "@/infrastructure/database/prisma/repositories/prisma-external-webhook-event-repository";
import { PrismaProfessionalOnboardingRepository } from "@/infrastructure/database/prisma/repositories/prisma-professional-onboarding-repository";
import { PrismaPayoutRepository } from "@/infrastructure/database/prisma/repositories/prisma-payout-repository";
import { PrismaProfessionalRepository } from "@/infrastructure/database/prisma/repositories/prisma-professional-repository";
import { PrismaUserRepository } from "@/infrastructure/database/prisma/repositories/prisma-user-repository";
import { env } from "@/infrastructure/config/env";
import { stripeConnectGateway, stripeConnectWebhookVerifier } from "@/infrastructure/payments/stripe/compose";
import { CreateStripeConnectedAccountUseCase } from "@/application/use-cases/stripe-connect/create-stripe-connected-account.use-case";
import { CreateStripeLoginLinkUseCase } from "@/application/use-cases/stripe-connect/create-stripe-login-link.use-case";
import { CreateStripeOnboardingLinkUseCase } from "@/application/use-cases/stripe-connect/create-stripe-onboarding-link.use-case";
import { GetStripeAccountStatusUseCase } from "@/application/use-cases/stripe-connect/get-stripe-account-status.use-case";
import { ProcessStripeConnectWebhookUseCase } from "@/application/use-cases/stripe-connect/process-stripe-connect-webhook.use-case";

/**
 * Module 71 — Stripe Connect: composition root — wires the Prisma
 * repositories and `StripeConnectGateway` to every Stripe Connect use
 * case. Same "one shared repository instance, one factory function per
 * use case" convention as `onboarding/compose.ts`/`verification/compose.ts`.
 */
const onboardings = new PrismaProfessionalOnboardingRepository();
const professionals = new PrismaProfessionalRepository();
const users = new PrismaUserRepository();
/** Module 72 — Stripe Webhooks: the same provider-agnostic idempotency
 *  ledger `verification/compose.ts` already wires for Persona — see
 *  `ExternalWebhookEventRepository`'s own doc comment. */
const webhookEvents = new PrismaExternalWebhookEventRepository();
/** Module 76 — Professional Payout Execution: reconciliation read/write
 *  target for `transfer.created` events — see
 *  `ProcessStripeConnectWebhookUseCase`'s own doc comment. */
const payouts = new PrismaPayoutRepository();

/**
 * Builds the refresh/return URLs Stripe's hosted onboarding flow redirects
 * to — both point back at the same professional-dashboard route; the
 * dashboard itself distinguishes "returned, still incomplete" from
 * "returned, complete" by calling `GetStripeAccountStatusUseCase`, not by
 * the URL. Kept as the one place `NEXT_PUBLIC_APP_URL` and the dashboard's
 * route shape are known, per `CreateStripeOnboardingLinkUseCase`'s own
 * doc comment.
 */
function buildOnboardingUrls(professionalProfileId: string): { refreshUrl: string; returnUrl: string } {
  const url = new URL("/dashboard/professional/onboarding/stripe", env.NEXT_PUBLIC_APP_URL);
  url.searchParams.set("professionalProfileId", professionalProfileId);
  return { refreshUrl: url.toString(), returnUrl: url.toString() };
}

export function makeCreateStripeConnectedAccountUseCase() {
  return new CreateStripeConnectedAccountUseCase(professionals, onboardings, users, stripeConnectGateway);
}

export function makeCreateStripeOnboardingLinkUseCase() {
  return new CreateStripeOnboardingLinkUseCase(professionals, onboardings, stripeConnectGateway, buildOnboardingUrls);
}

export function makeGetStripeAccountStatusUseCase() {
  return new GetStripeAccountStatusUseCase(professionals, onboardings, stripeConnectGateway);
}

export function makeCreateStripeLoginLinkUseCase() {
  return new CreateStripeLoginLinkUseCase(professionals, onboardings, stripeConnectGateway);
}

export function makeProcessStripeConnectWebhookUseCase() {
  return new ProcessStripeConnectWebhookUseCase(onboardings, webhookEvents, payouts);
}

/**
 * Module 72 — Stripe Webhooks: re-exports the single
 * `StripeConnectWebhookVerifier` instance — same "route only imports
 * from the application-layer compose, never infrastructure directly"
 * convention `getVerificationProviderInstance`
 * (`application/use-cases/verification/compose.ts`) already establishes
 * for Persona.
 */
export function getStripeConnectWebhookVerifierInstance() {
  return stripeConnectWebhookVerifier;
}
