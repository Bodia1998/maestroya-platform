import { ConflictError, NotFoundError } from "@/domain/errors/domain-error";
import { CompanyVerificationStatusChanged } from "@/domain/events/company-verification-status-changed";
import type { CompanyRepository } from "@/domain/repositories/company-repository";
import type { CompanyVerificationRecord, CompanyVerificationRepository } from "@/domain/repositories/company-verification-repository";
import { canApprove, canTransition, computeExpiresAt } from "@/domain/services/company-verification-rules";
import type { EventBus } from "@/application/ports/event-bus";
import { EventDispatchError } from "@/application/ports/event-dispatch-error";
import { type FailureReporter, NullFailureReporter } from "@/application/ports/failure-reporter";

/** Module 18 — Company Professional: an admin approves a case
 *  (PENDING/UNDER_REVIEW → APPROVED). Flips CompanyProfile.isVerified,
 *  notifies the company's owner. Mirrors ApproveProfessionalVerificationUseCase.
 *
 *  Module 37 — Domain Event Subscribers: see
 *  `ApproveProfessionalVerificationUseCase`'s own doc comment — same
 *  rationale, same pattern, mirrored here exactly. `recipientUserId` on the
 *  published event is `null` if the case's own company can no longer be
 *  found — the same defensive `if (company)` guard this use case had around
 *  its old inline `notify` call. */
export class ApproveCompanyVerificationUseCase {
  constructor(
    private readonly verifications: CompanyVerificationRepository,
    private readonly companies: CompanyRepository,
    private readonly eventBus: EventBus,
    private readonly failureReporter: FailureReporter = new NullFailureReporter(),
  ) {}

  async execute(adminUserId: string, verificationId: string): Promise<CompanyVerificationRecord> {
    const verification = await this.verifications.findById(verificationId);
    if (!verification) {
      throw new NotFoundError("CompanyVerification", verificationId);
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

    await this.verifications.setCompanyVerifiedStatus(verification.companyProfileId, true, now);

    const company = await this.companies.findById(verification.companyProfileId);

    try {
      await this.eventBus.publishAll([
        new CompanyVerificationStatusChanged(
          verificationId,
          verification.companyProfileId,
          company?.ownerUserId ?? null,
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
