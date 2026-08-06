import { ConflictError, NotFoundError, ValidationError } from "@/domain/errors/domain-error";
import { CompanyVerificationStatusChanged } from "@/domain/events/company-verification-status-changed";
import type { CompanyRepository } from "@/domain/repositories/company-repository";
import type { CompanyVerificationRecord, CompanyVerificationRepository } from "@/domain/repositories/company-verification-repository";
import { canRequestResubmission, canTransition, isValidReviewReason } from "@/domain/services/company-verification-rules";
import type { EventBus } from "@/application/ports/event-bus";
import { EventDispatchError } from "@/application/ports/event-dispatch-error";
import { type FailureReporter, NullFailureReporter } from "@/application/ports/failure-reporter";

/** Module 18 — Company Professional: an admin asks for a resubmission
 *  (a reason is required). Mirrors RequestVerificationResubmissionUseCase.
 *
 *  Module 37 — Domain Event Subscribers: see
 *  `ApproveCompanyVerificationUseCase`'s own doc comment — same rationale,
 *  same pattern, mirrored here exactly. */
export class RequestCompanyVerificationResubmissionUseCase {
  constructor(
    private readonly verifications: CompanyVerificationRepository,
    private readonly companies: CompanyRepository,
    private readonly eventBus: EventBus,
    private readonly failureReporter: FailureReporter = new NullFailureReporter(),
  ) {}

  async execute(adminUserId: string, verificationId: string, reason: string): Promise<CompanyVerificationRecord> {
    if (!isValidReviewReason(reason)) {
      throw new ValidationError("A resubmission reason of 10–1000 characters is required.");
    }

    const verification = await this.verifications.findById(verificationId);
    if (!verification) {
      throw new NotFoundError("CompanyVerification", verificationId);
    }

    if (!canRequestResubmission(verification.status) || !canTransition(verification.status, "RESUBMISSION_REQUIRED")) {
      throw new ConflictError("This verification request cannot request a resubmission in its current state.");
    }

    const updated = await this.verifications.updateStatus(verificationId, {
      status: "RESUBMISSION_REQUIRED",
      reviewedByUserId: adminUserId,
      reviewedAt: new Date(),
      resubmissionReason: reason.trim(),
      rejectionReason: null,
    });

    const company = await this.companies.findById(verification.companyProfileId);

    try {
      await this.eventBus.publishAll([
        new CompanyVerificationStatusChanged(
          verificationId,
          verification.companyProfileId,
          company?.ownerUserId ?? null,
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
