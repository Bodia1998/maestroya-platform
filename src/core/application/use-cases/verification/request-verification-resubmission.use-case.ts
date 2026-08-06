import { ConflictError, NotFoundError, ValidationError } from "@/domain/errors/domain-error";
import { ProfessionalVerificationStatusChanged } from "@/domain/events/professional-verification-status-changed";
import type { ProfessionalRepository } from "@/domain/repositories/professional-repository";
import type {
  ProfessionalVerificationRecord,
  ProfessionalVerificationRepository,
} from "@/domain/repositories/professional-verification-repository";
import { canRequestResubmission, canTransition, isValidReviewReason } from "@/domain/services/professional-verification-rules";
import type { EventBus } from "@/application/ports/event-bus";
import { EventDispatchError } from "@/application/ports/event-dispatch-error";
import { type FailureReporter, NullFailureReporter } from "@/application/ports/failure-reporter";

/**
 * Professional Verification module (Module 17): an admin asks the
 * professional to fix and resubmit (PENDING/UNDER_REVIEW →
 * RESUBMISSION_REQUIRED). A reason (instructions) is REQUIRED and stored on
 * the case so the professional sees exactly what to change. The public trust
 * signal stays PENDING (the professional is still mid-verification, not
 * rejected).
 *
 * Module 37 — Domain Event Subscribers: see `ApproveProfessionalVerificationUseCase`'s
 * own doc comment — same rationale, same pattern, mirrored here exactly.
 */
export class RequestVerificationResubmissionUseCase {
  constructor(
    private readonly verifications: ProfessionalVerificationRepository,
    private readonly professionals: ProfessionalRepository,
    private readonly eventBus: EventBus,
    private readonly failureReporter: FailureReporter = new NullFailureReporter(),
  ) {}

  async execute(adminUserId: string, verificationId: string, reason: string): Promise<ProfessionalVerificationRecord> {
    if (!isValidReviewReason(reason)) {
      throw new ValidationError("A resubmission reason is required.");
    }

    const verification = await this.verifications.findById(verificationId);
    if (!verification) {
      throw new NotFoundError("ProfessionalVerification", verificationId);
    }

    if (!canRequestResubmission(verification.status) || !canTransition(verification.status, "RESUBMISSION_REQUIRED")) {
      throw new ConflictError("A resubmission can only be requested for a pending or in-review request.");
    }

    const now = new Date();
    const updated = await this.verifications.updateStatus(verificationId, {
      status: "RESUBMISSION_REQUIRED",
      reviewedByUserId: adminUserId,
      reviewedAt: now,
      resubmissionReason: reason.trim(),
    });

    // Still mid-verification — keep the public signal PENDING.
    await this.verifications.setProfileVerificationStatus(verification.professionalProfileId, "PENDING", null);

    const professional = await this.professionals.findById(verification.professionalProfileId);

    try {
      await this.eventBus.publishAll([
        new ProfessionalVerificationStatusChanged(
          verificationId,
          verification.professionalProfileId,
          professional?.userId ?? null,
          verification.status,
          "RESUBMISSION_REQUIRED",
          adminUserId,
          "RESUBMISSION_REQUESTED",
        ),
      ]);
    } catch (error) {
      if (!(error instanceof EventDispatchError)) throw error;
      this.failureReporter.report(error, { event: error.eventName, eventId: error.eventId });
    }

    return updated;
  }
}
