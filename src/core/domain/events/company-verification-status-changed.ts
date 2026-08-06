import { DomainEvent } from "@/domain/events/domain-event";
import type { VerificationCaseStatusValue } from "@/domain/services/company-verification-rules";

/**
 * Module 37 — Domain Event Subscribers (Notifications & Audit Log).
 *
 * Raised whenever a `CompanyVerification` case transitions status (see
 * `SubmitCompanyVerificationUseCase`, `ResubmitCompanyVerificationUseCase`,
 * `ApproveCompanyVerificationUseCase`, `RejectCompanyVerificationUseCase`,
 * `RequestCompanyVerificationResubmissionUseCase` —
 * `application/use-cases/company-verification/`). Mirrors
 * `ProfessionalVerificationStatusChanged`
 * (`domain/events/professional-verification-status-changed.ts`) exactly —
 * same "several unrelated reactions to one business fact" shape, same
 * `transition` discriminant for the SUBMITTED-vs-RESUBMITTED case (both land
 * on `newStatus: "PENDING"` but need different audit action/notification
 * copy).
 */
export class CompanyVerificationStatusChanged extends DomainEvent {
  static readonly eventName = "company-verification.status-changed";

  constructor(
    readonly verificationId: string,
    readonly companyProfileId: string,
    /** The user to notify — the caller for submit/resubmit (the company
     *  member who performed the transition), the company's owner for
     *  approve/reject/request-resubmission (resolved server-side from
     *  `CompanyRepository`). `null` only in the defensive edge case where
     *  the case's own company can no longer be found — mirrors the
     *  `if (company)` guard the pre-Module-37 admin-side use cases had
     *  around their notify call. */
    readonly recipientUserId: string | null,
    readonly previousStatus: VerificationCaseStatusValue,
    readonly newStatus: VerificationCaseStatusValue,
    /** The user who performed the transition — an admin for approve/
     *  reject/request-resubmission, a company owner/admin member for
     *  submit/resubmit. */
    readonly actorUserId: string,
    readonly transition: "SUBMITTED" | "RESUBMITTED" | "APPROVED" | "REJECTED" | "RESUBMISSION_REQUESTED",
    /** Document count at submit/resubmit time — `null` for transitions
     *  that don't record it. */
    readonly documentCount: number | null = null,
  ) {
    super();
  }
}
