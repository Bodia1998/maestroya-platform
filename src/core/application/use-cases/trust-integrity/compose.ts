import { eventBus } from "@/infrastructure/events/compose";
import { PrismaTrustProfileRepository } from "@/infrastructure/database/prisma/repositories/prisma-trust-profile-repository";
import { PrismaOffPlatformDetectionRepository } from "@/infrastructure/database/prisma/repositories/prisma-off-platform-detection-repository";
import { PrismaFraudSignalRepository } from "@/infrastructure/database/prisma/repositories/prisma-fraud-signal-repository";
import { PrismaTrustAutomatedActionRepository } from "@/infrastructure/database/prisma/repositories/prisma-trust-automated-action-repository";
import { PrismaManualReviewCaseRepository } from "@/infrastructure/database/prisma/repositories/prisma-manual-review-case-repository";
import { PrismaTrustAppealRepository } from "@/infrastructure/database/prisma/repositories/prisma-trust-appeal-repository";
import { PrismaAccountRestrictionRepository } from "@/infrastructure/database/prisma/repositories/prisma-account-restriction-repository";
import { PrismaJobRepository } from "@/infrastructure/database/prisma/repositories/prisma-job-repository";
import { PrismaDisputeRepository } from "@/infrastructure/database/prisma/repositories/prisma-dispute-repository";
import { PrismaProfessionalRepository } from "@/infrastructure/database/prisma/repositories/prisma-professional-repository";
import {
  createOffPlatformDetectionProvider,
  createDeviceFingerprintProvider,
  createVpnProxyDetectionProvider,
  createPhoneReputationProvider,
} from "@/infrastructure/trust-integrity/trust-integrity-provider-factory";
import { PrismaFraudTrustSignalCheckRepository } from "@/infrastructure/database/prisma/repositories/prisma-fraud-trust-signal-check-repository";

import { RecordUserBehaviorSignalUseCase } from "@/application/use-cases/trust-integrity/record-user-behavior-signal.use-case";
import { GetUserTrustProfileUseCase } from "@/application/use-cases/trust-integrity/get-user-trust-profile.use-case";
import { ApplyAutomatedActionUseCase } from "@/application/use-cases/trust-integrity/apply-automated-action.use-case";
import { DetectOffPlatformCommunicationUseCase } from "@/application/use-cases/trust-integrity/detect-off-platform-communication.use-case";
import { DetectFraudSignalsUseCase } from "@/application/use-cases/trust-integrity/detect-fraud-signals.use-case";
import { CollectFraudTrustSignalsUseCase } from "@/application/use-cases/trust-integrity/collect-fraud-trust-signals.use-case";
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
import { DetectPrematureJobCompletionUseCase } from "@/application/use-cases/trust-integrity/detect-premature-job-completion.use-case";
import {
  DetectJobCompletionDisputeConflictUseCase,
  JobCompletionDisputeConflictOnDisputeCreatedSubscriber,
  JobCompletionDisputeConflictOnProfessionalCompletedJobSubscriber,
} from "@/application/use-cases/trust-integrity/detect-job-completion-dispute-conflict.use-case";
import { ProfessionalCompletedJob } from "@/domain/events/professional-completed-job";
import { DisputeCreated } from "@/domain/events/dispute-created";

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

// Module 67 — Trust & Integrity Completion Risk Detection: fresh Prisma
// repositories constructed directly here (never imported from
// job/compose.ts or dispute/compose.ts), mirroring the exact
// "each compose.ts constructs its own cross-module dependencies from
// Prisma repositories directly" convention job/compose.ts's own doc
// comment documents (avoids a compose-to-compose import cycle between
// trust-integrity, job, and dispute).
const jobs = new PrismaJobRepository();
const disputes = new PrismaDisputeRepository();
const professionals = new PrismaProfessionalRepository();
const fraudTrustSignalChecks = new PrismaFraudTrustSignalCheckRepository();

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

// --- Module 93 — Real Fraud & Trust Signal Providers ---

export function makeCollectFraudTrustSignalsUseCase(): CollectFraudTrustSignalsUseCase {
  return new CollectFraudTrustSignalsUseCase(
    createDeviceFingerprintProvider(),
    createVpnProxyDetectionProvider(),
    createPhoneReputationProvider(),
    fraudTrustSignalChecks,
    makeDetectFraudSignalsUseCase(),
  );
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

// --- Module 67 — Trust & Integrity Completion Risk Detection ---

export function makeDetectPrematureJobCompletionUseCase(): DetectPrematureJobCompletionUseCase {
  return new DetectPrematureJobCompletionUseCase(
    professionals,
    fraudSignals,
    makeRecordUserBehaviorSignalUseCase(),
    eventBus,
  );
}

export function makeDetectJobCompletionDisputeConflictUseCase(): DetectJobCompletionDisputeConflictUseCase {
  return new DetectJobCompletionDisputeConflictUseCase(
    jobs,
    disputes,
    professionals,
    fraudSignals,
    manualReviewCases,
    makeRecordUserBehaviorSignalUseCase(),
    eventBus,
  );
}

/**
 * Module 37 — Domain Event Subscribers: registers Module 67's two
 * detectors against the shared `eventBus`, at module-load time — the exact
 * pattern `infrastructure/events/compose.ts`'s own doc comment documents
 * and `dispute/compose.ts` already follows for its own four audit-log
 * subscribers. `ProfessionalCompletedJob` gets TWO independent subscribers
 * (Detector A and half of Detector B) — `EventBus.subscribe`'s own doc
 * comment states this explicitly: "Multiple handlers may subscribe to the
 * same event type; all of them run, in subscription order." Neither
 * detector's failure affects the other's — `SynchronousEventBus` (see that
 * class's own doc comment) surfaces a failing handler as an
 * `EventDispatchError` to the *publisher* (`CompleteJobUseCase`/
 * `CreateDisputeUseCase`, both of which already treat this as best-effort
 * via their own `FailureReporter` — see those classes' own doc comments),
 * never lets one handler's exception prevent a sibling handler on the same
 * event from running.
 *
 * This module's own detector-registration call was previously missing from
 * this file entirely (Module 65 registered zero subscribers of its own —
 * every existing `Detect*UseCase` here is invoked directly, never via the
 * event bus). This is also, correspondingly, the first time this file
 * needs to be added to `instrumentation.ts`'s deterministic-at-boot import
 * list — see that file's own updated comment.
 */
const detectPrematureJobCompletion = makeDetectPrematureJobCompletionUseCase();
eventBus.subscribe(ProfessionalCompletedJob, detectPrematureJobCompletion);

const detectJobCompletionDisputeConflict = makeDetectJobCompletionDisputeConflictUseCase();
eventBus.subscribe(
  ProfessionalCompletedJob,
  new JobCompletionDisputeConflictOnProfessionalCompletedJobSubscriber(detectJobCompletionDisputeConflict),
);
eventBus.subscribe(
  DisputeCreated,
  new JobCompletionDisputeConflictOnDisputeCreatedSubscriber(detectJobCompletionDisputeConflict),
);
