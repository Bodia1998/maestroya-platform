import { ConflictError, NotFoundError, ValidationError } from "@/domain/errors/domain-error";
import { ProfessionalVerificationStatusChanged } from "@/domain/events/professional-verification-status-changed";
import type { ProfessionalRepository } from "@/domain/repositories/professional-repository";
import type {
  ProfessionalVerificationRecord,
  ProfessionalVerificationRepository,
} from "@/domain/repositories/professional-verification-repository";
import { canReject, canTransition, isValidReviewReason } from "@/domain/services/professional-verification-rules";
import type { EventBus } from "@/application/ports/event-bus";
import { EventDispatchError } from "@/application/ports/event-dispatch-error";
import { type FailureReporter, NullFailureReporter } from "@/application/ports/failure-reporter";

/**
 * Professional Verification module (Module 17): an admin rejects a case
 * (PENDING/UNDER_REVIEW → REJECTED). A reason is REQUIRED (enforced here in
 * the use case, not just at the DTO boundary) and is surfaced to the
 * professional so they know why. Sets the public trust signal to REJECTED.
 * The professional may later resubmit (REJECTED → PENDING) — this is not
 * the end of the case.
 *
 * Module 37 — Domain Event Subscribers: see `ApproveProfessionalVerificationUseCase`'s
 * own doc comment — same rationale, same pattern, mirrored here exactly.
 */
export class RejectProfessionalVerificationUseCase {
  constructor(
    private readonly verifications: ProfessionalVerificationRepository,
    private readonly professionals: ProfessionalRepository,
    private readonly eventBus: EventBus,
    private readonly failureReporter: FailureReporter = new NullFailureReporter(),
  ) {}

  async execute(adminUserId: string, verificationId: string, reason: string): Promise<ProfessionalVerificationRecord> {
    if (!isValidReviewReason(reason)) {
      throw new ValidationError("A rejection reason is required.");
    }

    const verification = await this.verifications.findById(verificationId);
    if (!verification) {
      throw new NotFoundError("ProfessionalVerification", verificationId);
    }

    if (!canReject(verification.status) || !canTransition(verification.status, "REJECTED")) {
      throw new ConflictError("This verification request cannot be rejected in its current state.");
    }

    const now = new Date();
    const updated = await this.verifications.updateStatus(verificationId, {
      status: "REJECTED",
      reviewedByUserId: adminUserId,
      reviewedAt: now,
      rejectionReason: reason.trim(),
    });

    await this.verifications.setProfileVerificationStatus(verification.professionalProfileId, "REJECTED", null);

    const professional = await this.professionals.findById(verification.professionalProfileId);

    // The reason itself is stored on the case; the audit subscriber records
    // that a rejection happened without duplicating potentially-sensitive
    // prose (see RecordProfessionalVerificationAuditLogSubscriber).
    try {
      await this.eventBus.publishAll([
        new ProfessionalVerificationStatusChanged(
          verificationId,
          verification.professionalProfileId,
          professional?.userId ?? null,
          verification.status,
          "REJECTED",
          adminUserId,
          "REJECTED",
        ),
      ]);
    } catch (error) {
      if (!(error instanceof EventDispatchError)) throw error;
      this.failureReporter.report(error, { event: error.eventName, eventId: error.eventId });
    }

    return updated;
  }
}
