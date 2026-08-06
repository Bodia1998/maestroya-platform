import { ConflictError, NotFoundError, ValidationError } from "@/domain/errors/domain-error";
import { ProfessionalVerificationStatusChanged } from "@/domain/events/professional-verification-status-changed";
import type { ProfessionalRepository } from "@/domain/repositories/professional-repository";
import type {
  ProfessionalVerificationRecord,
  ProfessionalVerificationRepository,
} from "@/domain/repositories/professional-verification-repository";
import { canSubmit, canTransition, hasRequiredDocuments } from "@/domain/services/professional-verification-rules";
import type { EventBus } from "@/application/ports/event-bus";
import { EventDispatchError } from "@/application/ports/event-dispatch-error";
import { type FailureReporter, NullFailureReporter } from "@/application/ports/failure-reporter";

/**
 * Professional Verification module (Module 17): submits the authenticated
 * professional's DRAFT case into the admin review queue (DRAFT → PENDING).
 * Enforces server-side that (1) the caller owns the case, (2) it is actually
 * in DRAFT, and (3) at least one proof-of-identity document is present. Sets
 * the professional's public trust signal to PENDING.
 *
 * Module 37 — Domain Event Subscribers: this use case no longer writes the
 * audit log entry or notifies the professional itself — both happen
 * because `ProfessionalVerificationStatusChanged` is published through the
 * Module 34 `EventBus`, reacted to by
 * `RecordProfessionalVerificationAuditLogSubscriber`/
 * `NotifyProfessionalVerificationStatusChangeSubscriber`. See
 * `SuspendCompanyUseCase`'s own doc comment for the identical
 * publish-and-report-don't-rethrow rationale, mirrored here exactly.
 */
export class SubmitProfessionalVerificationUseCase {
  constructor(
    private readonly verifications: ProfessionalVerificationRepository,
    private readonly professionals: ProfessionalRepository,
    private readonly eventBus: EventBus,
    private readonly failureReporter: FailureReporter = new NullFailureReporter(),
  ) {}

  async execute(userId: string): Promise<ProfessionalVerificationRecord> {
    const professional = await this.professionals.findByUserId(userId);
    if (!professional || professional.status !== "ACTIVE") {
      throw new ValidationError("You must have an active professional profile to submit a verification request.");
    }

    const verification = await this.verifications.findActiveByProfessionalProfileId(professional.id);
    if (!verification) {
      throw new NotFoundError("ProfessionalVerification", professional.id);
    }

    if (!canSubmit(verification.status) || !canTransition(verification.status, "PENDING")) {
      throw new ConflictError("This verification request cannot be submitted in its current state.");
    }

    const documents = await this.verifications.listDocuments(verification.id);
    if (!hasRequiredDocuments(documents.map((d) => d.type))) {
      throw new ValidationError("Upload at least one identity document before submitting for review.");
    }

    const updated = await this.verifications.updateStatus(verification.id, {
      status: "PENDING",
      submittedAt: new Date(),
    });

    // Public trust signal: PENDING while under review.
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
          "SUBMITTED",
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
