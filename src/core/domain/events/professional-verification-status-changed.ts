import { DomainEvent } from "@/domain/events/domain-event";
import type { ProfessionalVerificationStatusValue } from "@/domain/services/professional-verification-rules";

/**
 * Module 37 — Domain Event Subscribers (Notifications & Audit Log).
 *
 * Raised whenever a `ProfessionalVerification` case transitions status
 * (see `SubmitProfessionalVerificationUseCase`,
 * `ResubmitProfessionalVerificationUseCase`,
 * `ApproveProfessionalVerificationUseCase`,
 * `RejectProfessionalVerificationUseCase`,
 * `RequestVerificationResubmissionUseCase` —
 * `application/use-cases/verification/`). Follows the exact shape
 * `CompanyStatusChanged` (`domain/events/company-status-changed.ts`)
 * established: those five use cases each had two independent side effects
 * glued directly into their `execute()` bodies (write an
 * `AdminAuditLogRepository` entry, best-effort `NotificationCreator.notify`
 * the professional) — the same "several unrelated reactions to one
 * business fact" shape the Module 34 `EventBus` exists for.
 *
 * `previousStatus`/`newStatus` alone cannot distinguish every transition a
 * subscriber must react to differently: submitting (DRAFT → PENDING) and
 * resubmitting (REJECTED/RESUBMISSION_REQUIRED → PENDING) both land on
 * `newStatus: "PENDING"` but need a different audit action and a different
 * notification title/message. `transition` carries that distinction
 * explicitly, named after the use case that raised it, rather than making
 * every subscriber re-derive it from a `previousStatus`/`newStatus` pair.
 */
export class ProfessionalVerificationStatusChanged extends DomainEvent {
  static readonly eventName = "professional-verification.status-changed";

  constructor(
    readonly verificationId: string,
    readonly professionalProfileId: string,
    /** The professional to notify — resolved server-side by the publishing
     *  use case, same as `CompanyStatusChanged.ownerUserId`. `null` only in
     *  the defensive edge case where the case's own professional profile
     *  can no longer be found (mirrors the `if (professional)` guard the
     *  pre-Module-37 admin-side use cases had around their notify call) —
     *  the audit-log subscriber still reacts; the notification subscriber
     *  is a no-op for a `null` recipient. */
    readonly professionalUserId: string | null,
    readonly previousStatus: ProfessionalVerificationStatusValue,
    readonly newStatus: ProfessionalVerificationStatusValue,
    /** The user who performed the transition — an admin for approve/
     *  reject/request-resubmission, the professional themselves for
     *  submit/resubmit. Mirrors `RecordAdminAuditLogData.adminUserId`'s own
     *  doc comment: a generic actor, not necessarily an admin. */
    readonly actorUserId: string,
    readonly transition: "SUBMITTED" | "RESUBMITTED" | "APPROVED" | "REJECTED" | "RESUBMISSION_REQUESTED",
    /** Document count at submit/resubmit time — `null` for transitions
     *  that don't record it. Carried on the event, not recomputed by the
     *  audit subscriber, so no subscriber needs a document-listing
     *  dependency it otherwise wouldn't need. */
    readonly documentCount: number | null = null,
  ) {
    super();
  }
}
