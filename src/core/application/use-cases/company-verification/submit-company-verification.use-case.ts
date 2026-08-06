import { ConflictError, NotFoundError, UnauthorizedError, ValidationError } from "@/domain/errors/domain-error";
import { CompanyVerificationStatusChanged } from "@/domain/events/company-verification-status-changed";
import type { CompanyMembershipRepository } from "@/domain/repositories/company-membership-repository";
import type { CompanyVerificationRecord, CompanyVerificationRepository } from "@/domain/repositories/company-verification-repository";
import { canManageCompanyProfile } from "@/domain/services/company-membership-rules";
import { canSubmit, canTransition, hasRequiredDocuments } from "@/domain/services/company-verification-rules";
import type { EventBus } from "@/application/ports/event-bus";
import { EventDispatchError } from "@/application/ports/event-dispatch-error";
import { type FailureReporter, NullFailureReporter } from "@/application/ports/failure-reporter";
import { resolveCompanyActor } from "@/application/use-cases/company/resolve-company-actor";

/** Module 18 — Company Professional: submits the company's DRAFT case into
 *  the admin review queue (DRAFT → PENDING). Mirrors
 *  SubmitProfessionalVerificationUseCase — requires at least one business
 *  document (BUSINESS_LICENSE/TAX_CERTIFICATE) before submission.
 *
 *  Module 37 — Domain Event Subscribers: this use case no longer writes the
 *  audit log entry or notifies the caller itself — both happen because
 *  `CompanyVerificationStatusChanged` is published through the Module 34
 *  `EventBus`, reacted to by `RecordCompanyVerificationAuditLogSubscriber`/
 *  `NotifyCompanyVerificationStatusChangeSubscriber`. See
 *  `SubmitProfessionalVerificationUseCase`'s own doc comment for the
 *  identical publish-and-report-don't-rethrow rationale. */
export class SubmitCompanyVerificationUseCase {
  constructor(
    private readonly verifications: CompanyVerificationRepository,
    private readonly memberships: CompanyMembershipRepository,
    private readonly eventBus: EventBus,
    private readonly failureReporter: FailureReporter = new NullFailureReporter(),
  ) {}

  async execute(userId: string, companyId: string): Promise<CompanyVerificationRecord> {
    const actor = await resolveCompanyActor(userId, companyId, this.memberships);
    if (!canManageCompanyProfile(actor.role)) {
      throw new UnauthorizedError("Only a company owner or admin may submit a verification request.");
    }

    const verification = await this.verifications.findActiveByCompanyProfileId(companyId);
    if (!verification) {
      throw new NotFoundError("CompanyVerification", companyId);
    }

    if (!canSubmit(verification.status) || !canTransition(verification.status, "PENDING")) {
      throw new ConflictError("This verification request cannot be submitted in its current state.");
    }

    const documents = await this.verifications.listDocuments(verification.id);
    if (!hasRequiredDocuments(documents.map((d) => d.type))) {
      throw new ValidationError("Upload at least one business registration document before submitting for review.");
    }

    const updated = await this.verifications.updateStatus(verification.id, {
      status: "PENDING",
      submittedAt: new Date(),
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
