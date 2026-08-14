import { eventBus } from "@/infrastructure/events/compose";
import { PrismaTrustProfileRepository } from "@/infrastructure/database/prisma/repositories/prisma-trust-profile-repository";
import { PrismaOffPlatformDetectionRepository } from "@/infrastructure/database/prisma/repositories/prisma-off-platform-detection-repository";
import { PrismaFraudSignalRepository } from "@/infrastructure/database/prisma/repositories/prisma-fraud-signal-repository";
import { PrismaTrustAutomatedActionRepository } from "@/infrastructure/database/prisma/repositories/prisma-trust-automated-action-repository";
import { PrismaManualReviewCaseRepository } from "@/infrastructure/database/prisma/repositories/prisma-manual-review-case-repository";
import { PrismaTrustAppealRepository } from "@/infrastructure/database/prisma/repositories/prisma-trust-appeal-repository";
import { PrismaAccountRestrictionRepository } from "@/infrastructure/database/prisma/repositories/prisma-account-restriction-repository";
import { createOffPlatformDetectionProvider } from "@/infrastructure/trust-integrity/trust-integrity-provider-factory";

import { RecordUserBehaviorSignalUseCase } from "@/application/use-cases/trust-integrity/record-user-behavior-signal.use-case";
import { GetUserTrustProfileUseCase } from "@/application/use-cases/trust-integrity/get-user-trust-profile.use-case";
import { ApplyAutomatedActionUseCase } from "@/application/use-cases/trust-integrity/apply-automated-action.use-case";
import { DetectOffPlatformCommunicationUseCase } from "@/application/use-cases/trust-integrity/detect-off-platform-communication.use-case";
import { DetectFraudSignalsUseCase } from "@/application/use-cases/trust-integrity/detect-fraud-signals.use-case";
import { DetectFakeReviewPatternsUseCase } from "@/application/use-cases/trust-integrity/detect-fake-review-patterns.use-case";
import { DetectSpamActivityUseCase } from "@/application/use-cases/trust-integrity/detect-spam-activity.use-case";
import { DetectSuspiciousPricingUseCase } from "@/application/use-cases/trust-integrity/detect-suspicious-pricing.use-case";
import { DetectBookingAbuseUseCase } from "@/application/use-cases/trust-integrity/detect-booking-abuse.use-case";
import { DetectPaymentAbuseUseCase } from "@/application/use-cases/trust-integrity/detect-payment-abuse.use-case";
import { DetectIdentityRiskUseCase } from "@/application/use-cases/trust-integrity/detect-identity-risk.use-case";
import { OpenManualReviewCaseUseCase } from "@/application/use-cases/trust-integrity/open-manual-review-case.use-case";
import { TransitionManualReviewCaseUseCase } from "@/application/use-cases/trust-integrity/transition-manual-review-case.use-case";
import { SubmitAppealUseCase } from "@/application/use-cases/trust-integrity/submit-appeal.use-case";
import { ReviewAppealUseCase } from "@/application/use-cases/trust-integrity/review-appeal.use-case";
import { GetTrustIntegrityStatisticsUseCase } from "@/application/use-cases/trust-integrity/get-trust-integrity-statistics.use-case";

/**
 * Module 65 — Trust & Integrity System: composition root, same "one
 * `make*UseCase` function per use case, wiring the shared singleton
 * `eventBus` and fresh Prisma-backed repositories" convention every other
 * module's own `compose.ts` follows (see `use-cases/materials/compose.ts`).
 */
const trustProfiles = new PrismaTrustProfileRepository();
const offPlatformDetection = new PrismaOffPlatformDetectionRepository();
const fraudSignals = new PrismaFraudSignalRepository();
const automatedActions = new PrismaTrustAutomatedActionRepository();
const manualReviewCases = new PrismaManualReviewCaseRepository();
const appeals = new PrismaTrustAppealRepository();
const accountRestrictions = new PrismaAccountRestrictionRepository();

export function makeRecordUserBehaviorSignalUseCase(): RecordUserBehaviorSignalUseCase {
  return new RecordUserBehaviorSignalUseCase(trustProfiles, eventBus);
}

export function makeGetUserTrustProfileUseCase(): GetUserTrustProfileUseCase {
  return new GetUserTrustProfileUseCase(trustProfiles);
}

export function makeApplyAutomatedActionUseCase(): ApplyAutomatedActionUseCase {
  return new ApplyAutomatedActionUseCase(automatedActions, accountRestrictions, eventBus);
}

export function makeDetectOffPlatformCommunicationUseCase(): DetectOffPlatformCommunicationUseCase {
  return new DetectOffPlatformCommunicationUseCase(
    createOffPlatformDetectionProvider(),
    offPlatformDetection,
    makeRecordUserBehaviorSignalUseCase(),
    eventBus,
  );
}

export function makeDetectFraudSignalsUseCase(): DetectFraudSignalsUseCase {
  return new DetectFraudSignalsUseCase(fraudSignals, makeRecordUserBehaviorSignalUseCase(), eventBus);
}

export function makeDetectFakeReviewPatternsUseCase(): DetectFakeReviewPatternsUseCase {
  return new DetectFakeReviewPatternsUseCase(fraudSignals, makeRecordUserBehaviorSignalUseCase(), eventBus);
}

export function makeDetectSpamActivityUseCase(): DetectSpamActivityUseCase {
  return new DetectSpamActivityUseCase(fraudSignals, makeRecordUserBehaviorSignalUseCase(), eventBus);
}

export function makeDetectSuspiciousPricingUseCase(): DetectSuspiciousPricingUseCase {
  return new DetectSuspiciousPricingUseCase(fraudSignals, makeRecordUserBehaviorSignalUseCase(), eventBus);
}

export function makeDetectBookingAbuseUseCase(): DetectBookingAbuseUseCase {
  return new DetectBookingAbuseUseCase(fraudSignals, makeRecordUserBehaviorSignalUseCase(), eventBus);
}

export function makeDetectPaymentAbuseUseCase(): DetectPaymentAbuseUseCase {
  return new DetectPaymentAbuseUseCase(fraudSignals, makeRecordUserBehaviorSignalUseCase(), eventBus);
}

export function makeDetectIdentityRiskUseCase(): DetectIdentityRiskUseCase {
  return new DetectIdentityRiskUseCase(fraudSignals, makeRecordUserBehaviorSignalUseCase(), eventBus);
}

export function makeOpenManualReviewCaseUseCase(): OpenManualReviewCaseUseCase {
  return new OpenManualReviewCaseUseCase(manualReviewCases, makeApplyAutomatedActionUseCase(), eventBus);
}

export function makeTransitionManualReviewCaseUseCase(): TransitionManualReviewCaseUseCase {
  return new TransitionManualReviewCaseUseCase(manualReviewCases, makeRecordUserBehaviorSignalUseCase(), eventBus);
}

export function makeSubmitAppealUseCase(): SubmitAppealUseCase {
  return new SubmitAppealUseCase(appeals, automatedActions, eventBus);
}

export function makeReviewAppealUseCase(): ReviewAppealUseCase {
  return new ReviewAppealUseCase(appeals, automatedActions, makeRecordUserBehaviorSignalUseCase(), eventBus);
}

export function makeGetTrustIntegrityStatisticsUseCase(): GetTrustIntegrityStatisticsUseCase {
  return new GetTrustIntegrityStatisticsUseCase(
    trustProfiles,
    fraudSignals,
    offPlatformDetection,
    automatedActions,
    manualReviewCases,
    appeals,
  );
}
