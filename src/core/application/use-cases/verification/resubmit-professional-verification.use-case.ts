import { ConflictError, NotFoundError, ValidationError } from "@/domain/errors/domain-error";
import { ProfessionalVerificationStatusChanged } from "@/domain/events/professional-verification-status-changed";
import type { ProfessionalRepository } from "@/domain/repositories/professional-repository";
import type {
  ProfessionalVerificationRecord,
  ProfessionalVerificationRepository,
} from "@/domain/repositories/professional-verification-repository";
import { canResubmit, canTransition, hasRequiredDocuments } from "@/domain/services/professional-verification-rules";
import type { EventBus } from "@/application/ports/event-bus";
import { EventDispatchError } from "@/application/ports/event-dispatch-error";
import { type FailureReporter, NullFailureReporter } from "@/application/ports/failure-reporter";

/**
 * Professional Verification module (Module 17): re-submits a case an admin
 * asked the professional to fix (RESUBMISSION_REQUIRED) or that was
 * previously REJECTED, moving it back to PENDING for another review round.
 * Same ownership/required-document guarantees as the first submission. Clears
 * the previous resubmission instructions and sets the public trust signal
 * back to PENDING.
 *
 * Module 37 — Domain Event Subscribers: see `SubmitProfessionalVerificationUseCase`'s
 * own doc comment — same rationale, same `ProfessionalVerificationStatusChanged`
 * publish-and-report-don't-rethrow pattern, mirrored here with
 * `transition: "RESUBMITTED"` so subscribers can tell this apart from a
 * first-time submission even though both land on `newStatus: "PENDING"`.
 */
export class ResubmitProfessionalVerificationUseCase {
  constructor(
    private readonly verifications: ProfessionalVerificationRepository,
    private readonly professionals: ProfessionalRepository,
    private readonly eventBus: EventBus,
    private readonly failureReporter: FailureReporter = new NullFailureReporter(),
  ) {}

  async execute(userId: string): Promise<ProfessionalVerificationRecord> {
    const professional = await this.professionals.findByUserId(userId);
    if (!professional || professional.status !== "ACTIVE") {
      throw new ValidationError("You must have an active professional profile to resubmit a verification request.");
    }

    const verification = await this.verifications.findActiveByProfessionalProfileId(professional.id);
    if (!verification) {
      throw new NotFoundError("ProfessionalVerification", professional.id);
    }

    if (!canResubmit(verification.status) || !canTransition(verification.status, "PENDING")) {
      throw new ConflictError("This verification request cannot be resubmitted in its current state.");
    }

    const documents = await this.verifications.listDocuments(verification.id);
    if (!hasRequiredDocuments(documents.map((d) => d.type))) {
      throw new ValidationError("Upload at least one identity document before resubmitting for review.");
    }

    const updated = await this.verifications.updateStatus(verification.id, {
      status: "PENDING",
      submittedAt: new Date(),
      // A fresh review round starts clean.
      resubmissionReason: null,
      rejectionReason: null,
    });

    await this.verifications.setProfileVerificationStatus(professional.id, "PENDING", null);

    try {
      await this.eventBus.publishAll([
        new ProfessionalVerificationStatusChanged(
          verification.id,
          professional.id,
          userId,
          verification.status,
          "PENDING",
          userId,
          "RESUBMITTED",
          documents.length,
        ),
      ]);
    } catch (error) {
      if (!(error instanceof EventDispatchError)) throw error;
      this.failureReporter.report(error, { event: error.eventName, eventId: error.eventId });
    }

    return updated;
  }
}
