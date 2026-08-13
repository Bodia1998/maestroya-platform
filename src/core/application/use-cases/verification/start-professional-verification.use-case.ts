import { ConflictError, ValidationError, VerificationProviderError } from "@/domain/errors/domain-error";
import { ProfessionalVerificationStatusChanged } from "@/domain/events/professional-verification-status-changed";
import type { ProfessionalRepository } from "@/domain/repositories/professional-repository";
import type {
  ProfessionalVerificationRecord,
  ProfessionalVerificationRepository,
} from "@/domain/repositories/professional-verification-repository";
import { canStartProviderVerification, canTransition } from "@/domain/services/professional-verification-rules";
import type { EventBus } from "@/application/ports/event-bus";
import { EventDispatchError } from "@/application/ports/event-dispatch-error";
import { type FailureReporter, NullFailureReporter } from "@/application/ports/failure-reporter";
import type { VerificationProvider } from "@/application/ports/verification-provider";

export interface StartProfessionalVerificationInput {
  userId: string;
  /** Resolved server-side from the authenticated session's own `User.name`
   *  — never accept this as raw client input. See
   *  `startProviderVerificationSchema`'s own doc comment
   *  (application/dto/verification.dto.ts). */
  fullName: string;
  countryCode: string;
}

export interface StartProfessionalVerificationResult {
  verification: ProfessionalVerificationRecord;
  /** Short-lived, provider-hosted URL the caller redirects the professional
   *  to. Never persisted (see `ProfessionalVerification`'s schema.prisma
   *  doc comment) — a caller that needs a fresh one later than this
   *  response calls `VerificationProvider.generateVerificationLink`
   *  directly with the case's own `providerVerificationId`. */
  verificationUrl: string;
}

/**
 * Module 59 — Professional Verification (Persona): starts (or restarts) an
 * automated provider-driven verification for the authenticated
 * professional — the "StartProfessionalVerification" use case from the
 * module brief.
 *
 * Reuses the Module 17 case exactly as the manual flow does: opens a fresh
 * DRAFT case if the professional has none yet (same rule
 * `CreateProfessionalVerificationUseCase` enforces — at most one active
 * case), otherwise reuses their existing REJECTED/RESUBMISSION_REQUIRED
 * case. `canStartProviderVerification` (professional-verification-rules.ts)
 * is exactly `canSubmit || canResubmit` — starting a Persona inquiry is an
 * alternative front door into the same PENDING state a manual document
 * upload would reach, not a parallel workflow.
 *
 * Deliberately does not require `hasRequiredDocuments` the way
 * `SubmitProfessionalVerificationUseCase`/`ResubmitProfessionalVerificationUseCase`
 * do — Persona's own hosted flow collects the identity document and
 * selfie directly from the professional (see `verificationUrl`), so no
 * `ProfessionalVerificationDocument` row needs to exist first. Uploading
 * documents through the Module 17 manual path and starting a Persona
 * inquiry both remain fully available on the same case at any point before
 * it leaves PENDING/UNDER_REVIEW — this use case does not disable one path
 * in favor of the other.
 *
 * Publishes the exact same `ProfessionalVerificationStatusChanged` event
 * the manual submit/resubmit use cases publish (`"SUBMITTED"` from DRAFT,
 * `"RESUBMITTED"` otherwise) — an admin's audit trail and the
 * professional's notification look identical regardless of which door the
 * case came in through, and no new event/subscriber had to be introduced.
 */
export class StartProfessionalVerificationUseCase {
  constructor(
    private readonly verifications: ProfessionalVerificationRepository,
    private readonly professionals: ProfessionalRepository,
    private readonly provider: VerificationProvider,
    private readonly eventBus: EventBus,
    private readonly failureReporter: FailureReporter = new NullFailureReporter(),
  ) {}

  async execute(input: StartProfessionalVerificationInput): Promise<StartProfessionalVerificationResult> {
    const professional = await this.professionals.findByUserId(input.userId);
    if (!professional || professional.status !== "ACTIVE") {
      throw new ValidationError("You must have an active professional profile to start identity verification.");
    }

    if (!input.fullName.trim()) {
      throw new ValidationError("Your account must have a name set before starting identity verification.");
    }

    let verification = await this.verifications.findActiveByProfessionalProfileId(professional.id);
    if (!verification) {
      verification = await this.verifications.create(professional.id);
    }

    if (!canStartProviderVerification(verification.status) || !canTransition(verification.status, "PENDING")) {
      throw new ConflictError("An automated identity check cannot be started for this verification in its current state.");
    }

    const fromStatus = verification.status;
    const transition = fromStatus === "DRAFT" ? "SUBMITTED" : "RESUBMITTED";

    const result = await this.provider.createVerification({
      verificationId: verification.id,
      fullName: input.fullName,
      countryCode: input.countryCode,
    });

    if (!result.providerVerificationId || !result.verificationUrl) {
      throw new VerificationProviderError(this.provider.name, "Provider returned an incomplete verification result.", false);
    }

    const now = new Date();
    const updated = await this.verifications.updateStatus(verification.id, {
      status: "PENDING",
      submittedAt: now,
      provider: this.provider.name,
      providerVerificationId: result.providerVerificationId,
      providerStatus: result.outcome,
      providerSyncedAt: now,
      resubmissionReason: null,
      rejectionReason: null,
    });

    await this.verifications.setProfileVerificationStatus(professional.id, "PENDING", null);

    try {
      await this.eventBus.publishAll([
        new ProfessionalVerificationStatusChanged(
          verification.id,
          professional.id,
          input.userId,
          fromStatus,
          "PENDING",
          input.userId,
          transition,
          null,
        ),
      ]);
    } catch (error) {
      if (!(error instanceof EventDispatchError)) throw error;
      this.failureReporter.report(error, { event: error.eventName, eventId: error.eventId });
    }

    return { verification: updated, verificationUrl: result.verificationUrl };
  }
}
