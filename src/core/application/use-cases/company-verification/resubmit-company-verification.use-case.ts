import { ConflictError, NotFoundError, UnauthorizedError, ValidationError } from "@/domain/errors/domain-error";
import { CompanyVerificationStatusChanged } from "@/domain/events/company-verification-status-changed";
import type { CompanyMembershipRepository } from "@/domain/repositories/company-membership-repository";
import type { CompanyVerificationRecord, CompanyVerificationRepository } from "@/domain/repositories/company-verification-repository";
import { canManageCompanyProfile } from "@/domain/services/company-membership-rules";
import { canResubmit, canTransition, hasRequiredDocuments } from "@/domain/services/company-verification-rules";
import type { EventBus } from "@/application/ports/event-bus";
import { EventDispatchError } from "@/application/ports/event-dispatch-error";
import { type FailureReporter, NullFailureReporter } from "@/application/ports/failure-reporter";
import { resolveCompanyActor } from "@/application/use-cases/company/resolve-company-actor";

/** Module 18 — Company Professional: resubmits after REJECTED or
 *  RESUBMISSION_REQUIRED (→ PENDING). Mirrors ResubmitProfessionalVerificationUseCase.
 *
 *  Module 37 — Domain Event Subscribers: see `SubmitCompanyVerificationUseCase`'s
 *  own doc comment — same rationale, same `CompanyVerificationStatusChanged`
 *  publish-and-report-don't-rethrow pattern, with `transition: "RESUBMITTED"`. */
export class ResubmitCompanyVerificationUseCase {
  constructor(
    private readonly verifications: CompanyVerificationRepository,
    private readonly memberships: CompanyMembershipRepository,
    private readonly eventBus: EventBus,
    private readonly failureReporter: FailureReporter = new NullFailureReporter(),
  ) {}

  async execute(userId: string, companyId: string): Promise<CompanyVerificationRecord> {
    const actor = await resolveCompanyActor(userId, companyId, this.memberships);
    if (!canManageCompanyProfile(actor.role)) {
      throw new UnauthorizedError("Only a company owner or admin may resubmit a verification request.");
    }

    const verification = await this.verifications.findActiveByCompanyProfileId(companyId);
    if (!verification) {
      throw new NotFoundError("CompanyVerification", companyId);
    }

    if (!canResubmit(verification.status) || !canTransition(verification.status, "PENDING")) {
      throw new ConflictError("This verification request cannot be resubmitted in its current state.");
    }

    const documents = await this.verifications.listDocuments(verification.id);
    if (!hasRequiredDocuments(documents.map((d) => d.type))) {
      throw new ValidationError("Upload at least one business registration document before resubmitting.");
    }

    const updated = await this.verifications.updateStatus(verification.id, {
      status: "PENDING",
      submittedAt: new Date(),
      rejectionReason: null,
      resubmissionReason: null,
    });

    try {
      await this.eventBus.publishAll([
        new CompanyVerificationStatusChanged(
          verification.id,
          companyId,
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
