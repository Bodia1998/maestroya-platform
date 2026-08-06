import type { AddressRecord } from "@/domain/repositories/address-repository";
import type { AppointmentSummary } from "@/domain/repositories/appointment-repository";
import type { CompanyInvitationRecord } from "@/domain/repositories/company-invitation-repository";
import type { CompanyMemberRecord } from "@/domain/repositories/company-membership-repository";
import type { ConsentRecord } from "@/domain/repositories/consent-repository";
import type { ConversationSummary } from "@/domain/repositories/conversation-repository";
import type { AdminAuditLogRecord } from "@/domain/repositories/admin-audit-log-repository";
import type { DisputeRecord } from "@/domain/repositories/dispute-repository";
import type { JobSummary } from "@/domain/repositories/job-repository";
import type { MessageRecord } from "@/domain/repositories/message-repository";
import type { NotificationRecord } from "@/domain/repositories/notification-repository";
import type { ProfessionalRecord } from "@/domain/repositories/professional-repository";
import type { ProfessionalVerificationWithDocuments } from "@/domain/repositories/professional-verification-repository";
import type { QuoteRecord } from "@/domain/repositories/quote-repository";
import type { ReviewRecord } from "@/domain/repositories/review-repository";
import type { ServiceRequestRecord } from "@/domain/repositories/service-request-repository";
import type { SupportTicketRecord } from "@/domain/repositories/support-ticket-repository";
import type { CustomerProfileRecord } from "@/domain/repositories/customer-profile-repository";
import type { UserProfileRecord } from "@/domain/repositories/user-repository";

/**
 * Module 38 — GDPR Compliance.
 *
 * Plain, JSON-serializable model returned by `ExportPersonalDataUseCase` —
 * "the export" itself. Deliberately not a class/entity: this is a
 * point-in-time read projection assembled fresh on every call, not
 * something with its own identity or lifecycle. No ZIP/file/email — see
 * the module's scope note; a delivery mechanism can serialize this with
 * plain `JSON.stringify` without any further transformation.
 *
 * Every field is scoped to data this platform can actually attribute to
 * the requesting user via an existing repository method — see
 * `gdpr-data-inventory.ts` for exactly which repository call backs each
 * field and the handful of documented scope limitations (e.g. company
 * memberships only include currently-active ones, because
 * `CompanyMembershipRepository` has no "including removed" listing by
 * user).
 */
export interface PersonalDataExport {
  userId: string;
  exportedAt: Date;

  account: {
    id: string;
    email: string | null;
    name: string | null;
    status: string;
    emailVerified: Date | null;
  } | null;
  profile: UserProfileRecord | null;
  address: AddressRecord | null;

  customerProfile: CustomerProfileRecord | null;
  professionalProfile: ProfessionalRecord | null;
  professionalVerification: ProfessionalVerificationWithDocuments | null;

  companyMemberships: CompanyMemberRecord[];
  companyInvitations: CompanyInvitationRecord[];

  serviceRequests: ServiceRequestRecord[];
  quotesSubmitted: QuoteRecord[];
  jobsAsCustomer: JobSummary[];
  jobsAsProfessional: JobSummary[];
  appointmentsAsCustomer: AppointmentSummary[];
  appointmentsAsProfessional: AppointmentSummary[];

  conversations: ConversationSummary[];
  messagesSent: MessageRecord[];

  notifications: NotificationRecord[];

  reviewsAuthored: ReviewRecord[];
  reviewsReceived: ReviewRecord[];

  supportTickets: SupportTicketRecord[];
  disputesRaised: DisputeRecord[];

  consents: ConsentRecord[];

  /** Best-effort — see `gdpr-data-inventory.ts`'s own doc comment on why
   *  this is scanned rather than queried directly (`AdminAuditLogRepository`
   *  has no `findByActorUserId`). */
  auditLogEntries: AdminAuditLogRecord[];
}
