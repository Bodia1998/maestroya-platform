import { BusinessRegistrationRequiredError, ConflictError, NotFoundError } from "@/domain/errors/domain-error";
import { ProfessionalVerificationStatusChanged } from "@/domain/events/professional-verification-status-changed";
import type { ProfessionalRepository } from "@/domain/repositories/professional-repository";
import type {
  ProfessionalVerificationRecord,
  ProfessionalVerificationRepository,
} from "@/domain/repositories/professional-verification-repository";
import {
  canApprove,
  canTransition,
  computeExpiresAt,
  hasBusinessRegistrationDocument,
} from "@/domain/services/professional-verification-rules";
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

    // Module 83 — Professional Verification Enforcement / Module 74 —
    // Business Registration Enforcement: identity proof alone (the only
    // thing `canSubmit`/`hasRequiredDocuments` requires before a case can
    // even reach PENDING) is not sufficient for a solo professional to be
    // approved — the platform's business rule also requires proof of
    // professional/business registration, mirroring the stronger
    // requirement already enforced at company-verification *submission*
    // time (company-verification-rules.ts's own hasRequiredDocuments,
    // which requires BUSINESS_LICENSE/TAX_CERTIFICATE). This is checked
    // here, at approval, rather than at submission, so the existing
    // identity-only submission flow (SubmitProfessionalVerificationUseCase)
    // is unchanged — an admin who hits this should reject or request
    // resubmission (both already-existing actions) asking the professional
    // to add the missing document; this method makes no changes when it
    // throws.
    const documents = await this.verifications.listDocuments(verificationId);
    if (!hasBusinessRegistrationDocument(documents.map((d) => d.type))) {
      throw new BusinessRegistrationRequiredError();
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
