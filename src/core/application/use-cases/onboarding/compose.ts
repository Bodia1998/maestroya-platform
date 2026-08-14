import { PrismaAddressRepository } from "@/infrastructure/database/prisma/repositories/prisma-address-repository";
import { PrismaAdminAuditLogRepository } from "@/infrastructure/database/prisma/repositories/prisma-admin-audit-log-repository";
import { PrismaConsentRepository } from "@/infrastructure/database/prisma/repositories/prisma-consent-repository";
import { PrismaProfessionalRepository } from "@/infrastructure/database/prisma/repositories/prisma-professional-repository";
import { PrismaProfessionalOnboardingRepository } from "@/infrastructure/database/prisma/repositories/prisma-professional-onboarding-repository";
import { PrismaProfessionalVerificationRepository } from "@/infrastructure/database/prisma/repositories/prisma-professional-verification-repository";
import { env } from "@/infrastructure/config/env";
import { eventBus } from "@/infrastructure/events/compose";
import { getPayoutProvider } from "@/infrastructure/payout/payout-provider-factory";
import { ProfessionalOnboardingActivated } from "@/domain/events/professional-onboarding-activated";
import { RecordOnboardingActivatedAuditLogSubscriber } from "@/application/use-cases/onboarding/record-onboarding-activated-audit-log.subscriber";
import { AcceptOnboardingPrivacyPolicyUseCase } from "@/application/use-cases/onboarding/accept-onboarding-privacy-policy.use-case";
import { AcceptOnboardingTermsUseCase } from "@/application/use-cases/onboarding/accept-onboarding-terms.use-case";
import { ActivateProfessionalUseCase } from "@/application/use-cases/onboarding/activate-professional.use-case";
import { GetOnboardingStatusUseCase } from "@/application/use-cases/onboarding/get-onboarding-status.use-case";
import { SetPayoutDestinationUseCase } from "@/application/use-cases/onboarding/set-payout-destination.use-case";
import { StartProfessionalOnboardingUseCase } from "@/application/use-cases/onboarding/start-professional-onboarding.use-case";
import { ValidateProfessionalActivationUseCase } from "@/application/use-cases/onboarding/validate-professional-activation.use-case";

/**
 * Module 62 — Professional Onboarding: composition root — wires the Prisma
 * implementations to every onboarding use case. Same "one shared repository
 * instance, one factory function per use case" convention as
 * `verification/compose.ts`/`referral/compose.ts`.
 *
 * `AUTH_SECRET` is reused as `AcceptOnboardingTermsUseCase`'s IP-hashing
 * pepper — the same value `referral/compose.ts` passes to `TrackVisitUseCase`
 * and `getClientIpHash()` uses for Module 24's own hashing (see that file's
 * own doc comment for why sharing the pepper is intentional).
 */
const onboardings = new PrismaProfessionalOnboardingRepository();
const professionals = new PrismaProfessionalRepository();
const addresses = new PrismaAddressRepository();
const consents = new PrismaConsentRepository();
const verifications = new PrismaProfessionalVerificationRepository();
const auditLog = new PrismaAdminAuditLogRepository();

/**
 * Module 37 — Domain Event Subscribers: registers this module's own
 * `ProfessionalOnboardingActivated` audit-log subscriber against the shared
 * `eventBus`, at module load time — same pattern `verification/compose.ts`
 * documents.
 */
eventBus.subscribe(ProfessionalOnboardingActivated, new RecordOnboardingActivatedAuditLogSubscriber(auditLog));

export function makeStartProfessionalOnboardingUseCase() {
  return new StartProfessionalOnboardingUseCase(onboardings, professionals);
}

export function makeAcceptOnboardingTermsUseCase() {
  return new AcceptOnboardingTermsUseCase(consents, eventBus, env.AUTH_SECRET);
}

export function makeAcceptOnboardingPrivacyPolicyUseCase() {
  return new AcceptOnboardingPrivacyPolicyUseCase(consents, eventBus);
}

export function makeSetPayoutDestinationUseCase() {
  return new SetPayoutDestinationUseCase(onboardings, professionals, getPayoutProvider);
}

export function makeGetOnboardingStatusUseCase() {
  return new GetOnboardingStatusUseCase(onboardings, professionals, addresses, consents, verifications);
}

export function makeValidateProfessionalActivationUseCase() {
  return new ValidateProfessionalActivationUseCase(makeGetOnboardingStatusUseCase());
}

export function makeActivateProfessionalUseCase() {
  return new ActivateProfessionalUseCase(
    onboardings,
    professionals,
    makeGetOnboardingStatusUseCase(),
    makeValidateProfessionalActivationUseCase(),
    eventBus,
  );
}
