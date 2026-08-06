import type { AddressRepository } from "@/domain/repositories/address-repository";
import type { AppointmentRepository } from "@/domain/repositories/appointment-repository";
import type { CompanyInvitationRepository } from "@/domain/repositories/company-invitation-repository";
import type { CompanyMembershipRepository } from "@/domain/repositories/company-membership-repository";
import type { ConsentRepository } from "@/domain/repositories/consent-repository";
import type { ConversationRepository } from "@/domain/repositories/conversation-repository";
import type { AdminAuditLogRepository } from "@/domain/repositories/admin-audit-log-repository";
import type { CustomerProfileRepository } from "@/domain/repositories/customer-profile-repository";
import type { DisputeRepository } from "@/domain/repositories/dispute-repository";
import type { JobRepository } from "@/domain/repositories/job-repository";
import type { MessageRepository } from "@/domain/repositories/message-repository";
import type { NotificationRepository } from "@/domain/repositories/notification-repository";
import type { ProfessionalRepository } from "@/domain/repositories/professional-repository";
import type { ProfessionalVerificationRepository } from "@/domain/repositories/professional-verification-repository";
import type { QuoteRepository } from "@/domain/repositories/quote-repository";
import type { ReviewRecord, ReviewRepository } from "@/domain/repositories/review-repository";
import type { ServiceRequestRepository } from "@/domain/repositories/service-request-repository";
import type { SupportTicketRepository } from "@/domain/repositories/support-ticket-repository";
import type { UserRepository } from "@/domain/repositories/user-repository";
import type { GdprDataCategoryValue } from "@/domain/services/gdpr-privacy-rules";
import type { PersonalDataExport } from "@/application/use-cases/gdpr/personal-data-export.dto";

/**
 * Module 38 — GDPR Compliance.
 *
 * `collectUserDataInventory` is the single place that walks every
 * repository holding user-owned data and assembles it into a
 * `PersonalDataExport` — shared by both `ExportPersonalDataUseCase`
 * (returns it as-is) and `PrepareAccountDeletionUseCase` (feeds it through
 * `groupIntoGdprCategories` + `gdpr-privacy-rules.ts` to build a deletion
 * plan). Neither use case duplicates this gathering logic.
 *
 * Scope limitations, all inherited from what the *existing* repository
 * interfaces this module was told not to widen actually expose (see the
 * module brief — reuse existing repositories, don't invent new query
 * methods on them):
 *
 *  - `companyMemberships` only includes **currently active** memberships
 *    (`CompanyMembershipRepository.listActiveCompaniesForUser`) — there is
 *    no "including historical/removed" query on that interface.
 *  - `reviewsReceived` only includes **PUBLISHED** reviews
 *    (`ReviewRepository.listByProfessionalId`'s own documented behavior) —
 *    a PENDING/FLAGGED/REMOVED review authored about this professional is
 *    not surfaced by any existing repository method scoped to a
 *    professional (only `findByJobId`, used for `reviewsAuthored` below).
 *  - `auditLogEntries` is a **best-effort scan**: `AdminAuditLogRepository`
 *    has no `findByActorUserId`/`findByTargetId`, only a paginated `list`
 *    of everything. This inventory fetches the most recent
 *    `AUDIT_LOG_SCAN_LIMIT` platform-wide entries and filters to this
 *    user's own — correct for a low-volume MVP audit log, but not a
 *    complete history once the table grows past that page. A real fix
 *    (adding an indexed `findByActorUserId` to `AdminAuditLogRepository`)
 *    is out of this module's scope (that repository belongs to Module 16 —
 *    Admin Panel).
 *  - Messages are gathered by listing every conversation the user belongs
 *    to and paging each conversation's messages, filtering to ones this
 *    user sent — `MessageRepository` has no direct "by sender" query.
 */

export const GDPR_LIST_LIMIT = 1000;
const AUDIT_LOG_SCAN_LIMIT = 1000;

export interface GdprInventoryRepos {
  users: UserRepository;
  customerProfiles: CustomerProfileRepository;
  professionals: ProfessionalRepository;
  addresses: AddressRepository;
  companyMembers: CompanyMembershipRepository;
  companyInvitations: CompanyInvitationRepository;
  serviceRequests: ServiceRequestRepository;
  quotes: QuoteRepository;
  jobs: JobRepository;
  appointments: AppointmentRepository;
  conversations: ConversationRepository;
  messages: MessageRepository;
  notifications: NotificationRepository;
  reviews: ReviewRepository;
  supportTickets: SupportTicketRepository;
  disputes: DisputeRepository;
  professionalVerifications: ProfessionalVerificationRepository;
  consents: ConsentRepository;
  auditLog: AdminAuditLogRepository;
}

export async function collectUserDataInventory(
  userId: string,
  repos: GdprInventoryRepos,
): Promise<PersonalDataExport> {
  const [account, profile, address, customerProfile, professional] = await Promise.all([
    repos.users.findById(userId),
    repos.users.findProfileById(userId),
    repos.addresses.findPrimaryByUserId(userId),
    repos.customerProfiles.findByUserId(userId),
    repos.professionals.findByUserId(userId),
  ]);

  const [companyMemberships, companyInvitations, notifications, supportTickets, disputesRaised, consents] =
    await Promise.all([
      repos.companyMembers.listActiveCompaniesForUser(userId),
      repos.companyInvitations.listForInvitedUser(userId),
      repos.notifications.listForUser(userId, { limit: GDPR_LIST_LIMIT, offset: 0 }),
      repos.supportTickets.listOpenedByUser(userId, { limit: GDPR_LIST_LIMIT, offset: 0 }),
      repos.disputes.listRaisedByUser(userId, { limit: GDPR_LIST_LIMIT, offset: 0 }),
      repos.consents.listByUser(userId),
    ]);

  const serviceRequests = customerProfile ? await repos.serviceRequests.findManyByCustomerId(customerProfile.id) : [];
  const quotesSubmitted = professional ? await repos.quotes.findManyByProfessionalId(professional.id) : [];

  const [jobsAsCustomer, jobsAsProfessional] = await Promise.all([
    customerProfile
      ? repos.jobs.listForCustomer(customerProfile.id, { limit: GDPR_LIST_LIMIT, offset: 0 })
      : Promise.resolve([]),
    professional
      ? repos.jobs.listForProfessional(professional.id, { limit: GDPR_LIST_LIMIT, offset: 0 })
      : Promise.resolve([]),
  ]);

  const [appointmentsAsCustomer, appointmentsAsProfessional] = await Promise.all([
    customerProfile
      ? repos.appointments.listForCustomer(customerProfile.id, { limit: GDPR_LIST_LIMIT, offset: 0 })
      : Promise.resolve([]),
    professional
      ? repos.appointments.listForProfessional(professional.id, { limit: GDPR_LIST_LIMIT, offset: 0 })
      : Promise.resolve([]),
  ]);

  const conversations = await repos.conversations.listForUser(userId);
  const messagesByConversation = await Promise.all(
    conversations.map((conversation) =>
      repos.messages.listByConversation(conversation.id, { limit: GDPR_LIST_LIMIT }),
    ),
  );
  const messagesSent = messagesByConversation.flat().filter((message) => message.senderId === userId);

  const reviewsAuthored: ReviewRecord[] = [];
  for (const job of jobsAsCustomer) {
    const review = await repos.reviews.findByJobId(job.id);
    if (review && review.reviewerId === userId) reviewsAuthored.push(review);
  }
  const reviewsReceived = professional
    ? await repos.reviews.listByProfessionalId(professional.id, { limit: GDPR_LIST_LIMIT, offset: 0 })
    : [];

  const professionalVerification = professional
    ? await repos.professionalVerifications.findActiveWithDocumentsByProfessionalProfileId(professional.id)
    : null;

  const auditLogPage = await repos.auditLog.list({ limit: AUDIT_LOG_SCAN_LIMIT, offset: 0 });
  const auditLogEntries = auditLogPage.filter((entry) => entry.adminUserId === userId);

  return {
    userId,
    exportedAt: new Date(),
    account: account
      ? {
          id: account.id,
          email: account.email,
          name: account.name,
          status: account.status,
          emailVerified: account.emailVerified,
        }
      : null,
    profile,
    address,
    customerProfile,
    professionalProfile: professional,
    professionalVerification,
    companyMemberships,
    companyInvitations,
    serviceRequests,
    quotesSubmitted,
    jobsAsCustomer,
    jobsAsProfessional,
    appointmentsAsCustomer,
    appointmentsAsProfessional,
    conversations,
    messagesSent,
    notifications,
    reviewsAuthored,
    reviewsReceived,
    supportTickets,
    disputesRaised,
    consents,
    auditLogEntries,
  };
}

/** Per-field record counts of a `PersonalDataExport` — the
 *  `PersonalDataExportPrepared` event's audit-log-friendly payload (see
 *  that event's own doc comment for why it carries counts, not data). */
export function computeCategoryCounts(inventory: PersonalDataExport): Record<string, number> {
  return {
    companyMemberships: inventory.companyMemberships.length,
    companyInvitations: inventory.companyInvitations.length,
    serviceRequests: inventory.serviceRequests.length,
    quotesSubmitted: inventory.quotesSubmitted.length,
    jobsAsCustomer: inventory.jobsAsCustomer.length,
    jobsAsProfessional: inventory.jobsAsProfessional.length,
    appointmentsAsCustomer: inventory.appointmentsAsCustomer.length,
    appointmentsAsProfessional: inventory.appointmentsAsProfessional.length,
    conversations: inventory.conversations.length,
    messagesSent: inventory.messagesSent.length,
    notifications: inventory.notifications.length,
    reviewsAuthored: inventory.reviewsAuthored.length,
    reviewsReceived: inventory.reviewsReceived.length,
    supportTickets: inventory.supportTickets.length,
    disputesRaised: inventory.disputesRaised.length,
    consents: inventory.consents.length,
    auditLogEntries: inventory.auditLogEntries.length,
  };
}

/**
 * Groups a `PersonalDataExport` inventory's record counts into the coarser
 * `GdprDataCategoryValue` buckets `gdpr-privacy-rules.ts` classifies —
 * `PrepareAccountDeletionUseCase`'s input into that domain service. One
 * inventory field can only ever belong to one category; several categories
 * sum more than one field (see each category's own rationale in
 * `gdpr-privacy-rules.ts`).
 */
export function groupIntoGdprCategories(inventory: PersonalDataExport): Record<GdprDataCategoryValue, number> {
  const profileRecordCount = [inventory.account, inventory.address, inventory.customerProfile].filter(
    (record) => record !== null,
  ).length;

  return {
    AUTH_CREDENTIALS: inventory.account ? 1 : 0,
    PROFILE_DATA: profileRecordCount,
    MARKETPLACE_ACTIVITY:
      inventory.serviceRequests.length +
      inventory.quotesSubmitted.length +
      inventory.appointmentsAsCustomer.length +
      inventory.appointmentsAsProfessional.length,
    MARKETPLACE_FINANCIAL: inventory.jobsAsCustomer.length + inventory.jobsAsProfessional.length,
    MESSAGES: inventory.conversations.length + inventory.messagesSent.length,
    REVIEWS: inventory.reviewsAuthored.length + inventory.reviewsReceived.length,
    NOTIFICATIONS: inventory.notifications.length,
    DISPUTES_AND_SUPPORT: inventory.disputesRaised.length + inventory.supportTickets.length,
    VERIFICATION_DOCUMENTS: inventory.professionalVerification?.documents.length ?? 0,
    AUDIT_LOG: inventory.auditLogEntries.length,
    CONSENT_RECORDS: inventory.consents.length,
    COMPANY_MEMBERSHIP: inventory.companyMemberships.length + inventory.companyInvitations.length,
  };
}
