import type { AdminAuditAction, AdminAuditLogRepository } from "@/domain/repositories/admin-audit-log-repository";
import type { CompanyVerificationStatusChanged } from "@/domain/events/company-verification-status-changed";
import type { EventHandler } from "@/application/ports/event-bus";

const ACTION_FOR_TRANSITION: Record<CompanyVerificationStatusChanged["transition"], AdminAuditAction> = {
  SUBMITTED: "COMPANY_VERIFICATION_SUBMITTED",
  RESUBMITTED: "COMPANY_VERIFICATION_RESUBMITTED",
  APPROVED: "COMPANY_VERIFICATION_APPROVED",
  REJECTED: "COMPANY_VERIFICATION_REJECTED",
  RESUBMISSION_REQUESTED: "COMPANY_VERIFICATION_RESUBMISSION_REQUESTED",
};

/**
 * Module 37 — Domain Event Subscribers (Notifications & Audit Log).
 *
 * The `AuditLogSubscriber` for `CompanyVerificationStatusChanged`
 * (`domain/events/company-verification-status-changed.ts`) — mirrors
 * `RecordProfessionalVerificationAuditLogSubscriber` exactly. Reacts to the
 * event by writing the same `AdminAuditLogRepository.record` call
 * `SubmitCompanyVerificationUseCase`/`ResubmitCompanyVerificationUseCase`/
 * `ApproveCompanyVerificationUseCase`/`RejectCompanyVerificationUseCase`/
 * `RequestCompanyVerificationResubmissionUseCase` used to make directly.
 *
 * `metadata` reproduces each use case's own pre-Module-37 metadata:
 * `{ companyId: companyProfileId, documentCount }` for SUBMITTED/RESUBMITTED,
 * `{ companyProfileId }` for APPROVED/REJECTED/RESUBMISSION_REQUESTED.
 */
export class RecordCompanyVerificationAuditLogSubscriber
  implements EventHandler<CompanyVerificationStatusChanged>
{
  constructor(private readonly auditLog: AdminAuditLogRepository) {}

  async handle(event: CompanyVerificationStatusChanged): Promise<void> {
    const metadata =
      event.transition === "SUBMITTED" || event.transition === "RESUBMITTED"
        ? { companyId: event.companyProfileId, documentCount: event.documentCount }
        : { companyProfileId: event.companyProfileId };

    await this.auditLog.record({
      adminUserId: event.actorUserId,
      action: ACTION_FOR_TRANSITION[event.transition],
      targetType: "CompanyVerification",
      targetId: event.verificationId,
      metadata,
    });
  }
}
