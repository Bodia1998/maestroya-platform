import { ConflictError, NotFoundError } from "@/domain/errors/domain-error";
import { ProfessionalVerificationStatusChanged } from "@/domain/events/professional-verification-status-changed";
import type { ProfessionalRepository } from "@/domain/repositories/professional-repository";
import type {
  ProfessionalVerificationRecord,
  ProfessionalVerificationRepository,
} from "@/domain/repositories/professional-verification-repository";
import { canApprove, canTransition, computeExpiresAt } from "@/domain/services/professional-verification-rules";
import type { EventBus } from "@/application/ports/event-bus";
import { EventDispatchError } from "@/application/ports/event-dispatch-error";
import { type FailureReporter, NullFailureReporter } from "@/application/ports/failure-reporter";

/**
 * Professional Verification module (Module 17): an admin approves a case
 * (PENDING/UNDER_REVIEW → APPROVED). Sets the reviewer, review timestamp and
 * an expiry, flips the professional's public trust signal to VERIFIED (with
 * `verifiedAt`). The recipient is resolved server-side from the case's own
 * professional, never from client input.
 *
 * Module 37 — Domain Event Subscribers: see `SubmitProfessionalVerificationUseCase`'s
 * own doc comment — same rationale, same `ProfessionalVerificationStatusChanged`
 * publish-and-report-don't-rethrow pattern. `professionalUserId` on the
 * published event is `null` if the case's own professional profile can no
 * longer be found — the same defensive `if (professional)` guard this use
 * case had around its old inline `notify` call, now expressed as "the
 * notification subscriber no-ops for a null recipient" instead.
 */
export class ApproveProfessionalVerificationUseCase {
  constructor(
    private readonly verifications: ProfessionalVerificationRepository,
    private readonly professionals: ProfessionalRepository,
    private readonly eventBus: EventBus,
    private readonly failureReporter: FailureReporter = new NullFailureReporter(),
  ) {}

  async execute(adminUserId: string, verificationId: string): Promise<ProfessionalVerificationRecord> {
    const verification = await this.verifications.findById(verificationId);
    if (!verification) {
      throw new NotFoundError("ProfessionalVerification", verificationId);
    }

    if (!canApprove(verification.status) || !canTransition(verification.status, "APPROVED")) {
      throw new ConflictError("This verification request cannot be approved in its current state.");
    }

    const now = new Date();
    const updated = await this.verifications.updateStatus(verificationId, {
      status: "APPROVED",
      reviewedByUserId: adminUserId,
      reviewedAt: now,
      expiresAt: computeExpiresAt(now),
      rejectionReason: null,
      resubmissionReason: null,
    });

    await this.verifications.setProfileVerificationStatus(verification.professionalProfileId, "VERIFIED", now);

    const professional = await this.professionals.findById(verification.professionalProfileId);

    try {
      await this.eventBus.publishAll([
        new ProfessionalVerificationStatusChanged(
          verificationId,
          verification.professionalProfileId,
          professional?.userId ?? null,
          verification.status,
          "APPROVED",
          adminUserId,
          "APPROVED",
        ),
      ]);
    } catch (error) {
      if (!(error instanceof EventDispatchError)) throw error;
      this.failureReporter.report(error, { event: error.eventName, eventId: error.eventId });
    }

    return updated;
  }
}
