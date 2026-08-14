import type {
  AddressRecord,
  AddressRepository,
  UpsertAddressData,
} from "@/domain/repositories/address-repository";
import type {
  AdminAuditLogRecord,
  AdminAuditLogRepository,
  ListAdminAuditLogsOptions,
  RecordAdminAuditLogData,
} from "@/domain/repositories/admin-audit-log-repository";
import type {
  AppointmentDetailRecord,
  AppointmentRepository,
  AppointmentSummary,
  CancelAppointmentData,
  CompleteAppointmentData,
  ListAppointmentsOptions,
  ProposeAppointmentTimeData,
  RescheduleAppointmentData,
  RescheduleAppointmentResult,
} from "@/domain/repositories/appointment-repository";
import type {
  CompanyInvitationRecord,
  CompanyInvitationRepository,
  CreateCompanyInvitationData,
} from "@/domain/repositories/company-invitation-repository";
import type {
  CompanyMemberRecord,
  CompanyMembershipRepository,
  CompanyMemberWithUser,
} from "@/domain/repositories/company-membership-repository";
import type { CompanyMemberRoleValue } from "@/domain/services/company-membership-rules";
import type {
  ConsentRecord,
  ConsentRepository,
  CreateConsentData,
} from "@/domain/repositories/consent-repository";
import type { ConsentTypeValue } from "@/domain/value-objects/consent-type";
import type {
  ConversationRecord,
  ConversationRepository,
  ConversationSummary,
} from "@/domain/repositories/conversation-repository";
import type {
  CustomerProfileRecord,
  CustomerProfileRepository,
} from "@/domain/repositories/customer-profile-repository";
import type {
  CreateDisputeData,
  DisputeRecord,
  DisputeRepository,
  ListAdminDisputesOptions,
  ListDisputesOptions,
} from "@/domain/repositories/dispute-repository";
import type {
  CancelJobData,
  CompleteJobData,
  JobRecord,
  JobRepository,
  JobSummary,
  ListJobsOptions,
  StartJobData,
} from "@/domain/repositories/job-repository";
import type {
  CreateMessageData,
  ListMessagesOptions,
  MessageRecord,
  MessageRepository,
} from "@/domain/repositories/message-repository";
import type {
  CreateNotificationData,
  ListNotificationsOptions,
  NotificationRecord,
  NotificationRepository,
} from "@/domain/repositories/notification-repository";
import type {
  CreateProfessionalData,
  ProfessionalRecord,
  ProfessionalRepository,
  ProfessionalStatusValue,
  UpdateProfessionalData,
} from "@/domain/repositories/professional-repository";
import type {
  AddVerificationDocumentData,
  AdminVerificationDetail,
  AdminVerificationListItem,
  ProfessionalVerificationRecord,
  ProfessionalVerificationRepository,
  ProfessionalVerificationWithDocuments,
  UpdateVerificationStatusData,
  VerificationDocumentRecord,
} from "@/domain/repositories/professional-verification-repository";
import type {
  CreateQuoteData,
  QuoteRecord,
  QuoteRepository,
  QuoteStatusValue,
  UpdateQuoteFields,
} from "@/domain/repositories/quote-repository";
import type {
  CreateReviewData,
  ProfessionalRatingSummary,
  ReviewRecord,
  ReviewRepository,
  ListProfessionalReviewsOptions,
} from "@/domain/repositories/review-repository";
import type {
  CreateServiceRequestData,
  RequestPhotoRecord,
  ServiceRequestRecord,
  ServiceRequestRepository,
  UpdateServiceRequestFields,
} from "@/domain/repositories/service-request-repository";
import type {
  CreateSupportTicketData,
  ListAdminSupportTicketsOptions,
  ListSupportTicketsOptions,
  SupportTicketRecord,
  SupportTicketRepository,
} from "@/domain/repositories/support-ticket-repository";
import type {
  AuthUserRecord,
  SignupIntentValue,
  UpdateProfileData,
  UserProfileRecord,
  UserRepository,
} from "@/domain/repositories/user-repository";

/**
 * Module 38 — GDPR Compliance: in-memory test doubles for the (large)
 * set of repositories `ExportPersonalDataUseCase`/`PrepareAccountDeletionUseCase`
 * read from — same "implement the real interface, storage-only fake" pattern
 * as every other module's fakes.ts (see tests/integration/dispute/fakes.ts's
 * own doc comment). Methods this module's use cases never call are still
 * implemented (for interface completeness) with the simplest behavior that
 * satisfies the interface's contract, not exercised by any assertion here.
 */

let idCounter = 0;
function nextId(prefix: string) {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

export class FakeUserRepository implements UserRepository {
  users = new Map<string, AuthUserRecord>();
  profiles = new Map<string, UserProfileRecord>();

  async findByEmail(email: string) {
    return [...this.users.values()].find((u) => u.email === email) ?? null;
  }
  async findById(id: string) {
    return this.users.get(id) ?? null;
  }
  async createWithPassword(input: { email: string; name: string; passwordHash: string }) {
    const user: AuthUserRecord = {
      id: nextId("user"),
      email: input.email,
      name: input.name,
      passwordHash: input.passwordHash,
      emailVerified: null,
      status: "PENDING_VERIFICATION",
    };
    this.users.set(user.id, user);
    return user;
  }
  async updatePasswordHash() {}
  async markEmailVerified() {}
  async updateLastLoginAt() {}
  async getRoleKeys() {
    return [];
  }
  async assignDefaultRole() {}
  async getSignupIntent(): Promise<SignupIntentValue | null> {
    return null;
  }
  async clearSignupIntent() {}
  async findProfileById(userId: string) {
    return this.profiles.get(userId) ?? null;
  }
  async updateProfile(userId: string, data: UpdateProfileData) {
    const existing = this.profiles.get(userId);
    if (existing) this.profiles.set(userId, { ...existing, ...data } as UserProfileRecord);
  }
  async updateAvatar() {}
  async softDeleteAccount() {}
  async getPreferredLocale() {
    return null;
  }
  async updatePreferredLocale() {}
}

export class FakeCustomerProfileRepository implements CustomerProfileRepository {
  profiles = new Map<string, CustomerProfileRecord>();

  async findByUserId(userId: string) {
    return [...this.profiles.values()].find((p) => p.userId === userId) ?? null;
  }
  async findById(id: string) {
    return this.profiles.get(id) ?? null;
  }
  async findOrCreateByUserId(userId: string) {
    const existing = await this.findByUserId(userId);
    if (existing) return existing;
    const record: CustomerProfileRecord = { id: nextId("cust"), userId };
    this.profiles.set(record.id, record);
    return record;
  }
}

export class FakeProfessionalRepository implements ProfessionalRepository {
  professionals = new Map<string, ProfessionalRecord>();

  async findById(id: string) {
    return this.professionals.get(id) ?? null;
  }
  async findByUserId(userId: string) {
    return [...this.professionals.values()].find((p) => p.userId === userId) ?? null;
  }
  async create(userId: string, data: CreateProfessionalData) {
    const record: ProfessionalRecord = {
      id: nextId("prof"),
      userId,
      businessName: data.businessName ?? null,
      bio: data.bio ?? null,
      headline: data.headline ?? null,
      yearsExperience: data.yearsExperience ?? null,
      hourlyRate: data.hourlyRate ?? null,
      serviceRadiusKm: data.serviceRadiusKm ?? null,
      contactEmail: data.contactEmail ?? null,
      contactPhone: data.contactPhone ?? null,
      websiteUrl: data.websiteUrl ?? null,
      taxId: data.taxId ?? null,
      status: "ACTIVE",
      verificationStatus: "UNVERIFIED",
      verifiedAt: null,
      isAcceptingRequests: true,
      categoryIds: data.categoryIds ?? [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.professionals.set(record.id, record);
    return record;
  }
  async update(id: string, data: UpdateProfessionalData) {
    const existing = this.professionals.get(id)!;
    const updated = { ...existing, ...data, updatedAt: new Date() };
    this.professionals.set(id, updated);
    return updated;
  }
  async updateStatus(id: string, status: ProfessionalStatusValue) {
    const existing = this.professionals.get(id);
    if (existing) this.professionals.set(id, { ...existing, status });
  }
  async updateCategories(id: string, categoryIds: string[]) {
    const existing = this.professionals.get(id)!;
    const updated = { ...existing, categoryIds };
    this.professionals.set(id, updated);
    return updated;
  }
}

export class FakeAddressRepository implements AddressRepository {
  addresses = new Map<string, AddressRecord>();

  async findPrimaryByUserId(userId: string) {
    return this.addresses.get(userId) ?? null;
  }
  async upsertPrimaryForUser(userId: string, data: UpsertAddressData) {
    const record: AddressRecord = {
      id: nextId("addr"),
      line1: data.line1,
      line2: data.line2 ?? null,
      city: data.city,
      province: data.province ?? null,
      postalCode: data.postalCode,
      country: data.country,
      latitude: data.latitude ?? null,
      longitude: data.longitude ?? null,
    };
    this.addresses.set(userId, record);
    return record;
  }
}

export class FakeCompanyMembershipRepository implements CompanyMembershipRepository {
  members = new Map<string, CompanyMemberRecord>();

  async findById(id: string) {
    return this.members.get(id) ?? null;
  }
  async findByCompanyAndUser(companyId: string, userId: string) {
    return [...this.members.values()].find((m) => m.companyId === companyId && m.userId === userId) ?? null;
  }
  async listActiveCompaniesForUser(userId: string) {
    return [...this.members.values()].filter((m) => m.userId === userId && m.removedAt === null);
  }
  async listByCompany(companyId: string): Promise<CompanyMemberWithUser[]> {
    return [...this.members.values()]
      .filter((m) => m.companyId === companyId)
      .map((m) => ({ ...m, userName: null, userEmail: null }));
  }
  async findOwner(companyId: string) {
    return [...this.members.values()].find((m) => m.companyId === companyId && m.role === "OWNER") ?? null;
  }
  async countActiveMembers(companyId: string) {
    return [...this.members.values()].filter((m) => m.companyId === companyId && m.removedAt === null).length;
  }
  async createOwner(companyId: string, userId: string) {
    return this.addMember(companyId, userId, "OWNER");
  }
  async createFromAcceptedInvitation(companyId: string, userId: string, role: CompanyMemberRoleValue) {
    return this.addMember(companyId, userId, role);
  }
  async updateRole(id: string, role: CompanyMemberRoleValue) {
    const existing = this.members.get(id)!;
    const updated = { ...existing, role };
    this.members.set(id, updated);
    return updated;
  }
  async remove(id: string, removedAt: Date) {
    const existing = this.members.get(id);
    if (existing) this.members.set(id, { ...existing, removedAt });
  }
  async transferOwnership() {}

  private addMember(companyId: string, userId: string, role: CompanyMemberRoleValue): CompanyMemberRecord {
    const record: CompanyMemberRecord = {
      id: nextId("member"),
      companyId,
      userId,
      role,
      invitedAt: new Date(),
      joinedAt: new Date(),
      removedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.members.set(record.id, record);
    return record;
  }
}

export class FakeCompanyInvitationRepository implements CompanyInvitationRepository {
  invitations = new Map<string, CompanyInvitationRecord>();

  async findById(id: string) {
    return this.invitations.get(id) ?? null;
  }
  async findByTokenHash(tokenHash: string) {
    return [...this.invitations.values()].find((i) => i.tokenHash === tokenHash) ?? null;
  }
  async findPendingByCompanyAndEmail(companyId: string, email: string) {
    return (
      [...this.invitations.values()].find(
        (i) => i.companyId === companyId && i.email === email && i.status === "PENDING",
      ) ?? null
    );
  }
  async listByCompany(companyId: string) {
    return [...this.invitations.values()].filter((i) => i.companyId === companyId);
  }
  async listForInvitedUser(userId: string) {
    return [...this.invitations.values()].filter((i) => i.invitedUserId === userId);
  }
  async create(data: CreateCompanyInvitationData) {
    const record: CompanyInvitationRecord = {
      id: nextId("invite"),
      companyId: data.companyId,
      email: data.email,
      invitedUserId: data.invitedUserId,
      invitedByUserId: data.invitedByUserId,
      role: data.role,
      status: "PENDING",
      tokenHash: data.tokenHash,
      expiresAt: data.expiresAt,
      acceptedAt: null,
      declinedAt: null,
      cancelledAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.invitations.set(record.id, record);
    return record;
  }
  async updateStatus(id: string, data: Partial<CompanyInvitationRecord>) {
    const existing = this.invitations.get(id)!;
    const updated = { ...existing, ...data } as CompanyInvitationRecord;
    this.invitations.set(id, updated);
    return updated;
  }
}

export class FakeServiceRequestRepository implements ServiceRequestRepository {
  requests = new Map<string, ServiceRequestRecord>();

  async findById(id: string) {
    return this.requests.get(id) ?? null;
  }
  async findManyByCustomerId(customerId: string) {
    return [...this.requests.values()].filter((r) => r.customerId === customerId);
  }
  async create(customerId: string, _userId: string, data: CreateServiceRequestData) {
    const record: ServiceRequestRecord = {
      id: nextId("sr"),
      customerId,
      categoryId: data.categoryId,
      categoryName: "Category",
      title: data.title,
      description: data.description,
      status: "PUBLISHED",
      urgency: data.urgency,
      budgetMin: data.budgetMin,
      budgetMax: data.budgetMax,
      location: data.location,
      photos: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.requests.set(record.id, record);
    return record;
  }
  async update(id: string, data: UpdateServiceRequestFields) {
    const existing = this.requests.get(id)!;
    const updated = { ...existing, ...data, updatedAt: new Date() };
    this.requests.set(id, updated);
    return updated;
  }
  async updateStatus(id: string, status: ServiceRequestRecord["status"]) {
    const existing = this.requests.get(id);
    if (existing) this.requests.set(id, { ...existing, status });
  }
  async addPhoto(serviceRequestId: string, url: string, caption: string | null) {
    const photo: RequestPhotoRecord = { id: nextId("photo"), url, caption, sortOrder: 0 };
    const existing = this.requests.get(serviceRequestId);
    if (existing) existing.photos.push(photo);
    return photo;
  }
  async removePhoto(serviceRequestId: string, photoId: string) {
    const existing = this.requests.get(serviceRequestId);
    if (existing) existing.photos = existing.photos.filter((p) => p.id !== photoId);
  }
  async countPhotos(serviceRequestId: string) {
    return this.requests.get(serviceRequestId)?.photos.length ?? 0;
  }
  async findExpirable() {
    return [];
  }
}

export class FakeQuoteRepository implements QuoteRepository {
  quotes = new Map<string, QuoteRecord>();

  async findById(id: string) {
    return this.quotes.get(id) ?? null;
  }
  async findManyByProfessionalId(professionalProfileId: string, status?: QuoteStatusValue) {
    return [...this.quotes.values()].filter(
      (q) => q.professionalProfileId === professionalProfileId && (!status || q.status === status),
    );
  }
  async findManyByServiceRequestId(serviceRequestId: string) {
    return [...this.quotes.values()].filter((q) => q.serviceRequestId === serviceRequestId);
  }
  async findActiveByServiceRequestAndProfessional() {
    return null;
  }
  async findByServiceRequestAndProfessional(serviceRequestId: string, professionalProfileId: string) {
    return (
      [...this.quotes.values()].find(
        (q) => q.serviceRequestId === serviceRequestId && q.professionalProfileId === professionalProfileId,
      ) ?? null
    );
  }
  async create(data: CreateQuoteData) {
    const items = data.items.map((item, index) => ({
      id: nextId("item"),
      description: item.description,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      amount: item.quantity * item.unitPrice,
      sortOrder: index,
      category: item.category ?? "LABOR",
    }));
    const record: QuoteRecord = {
      id: nextId("quote"),
      serviceRequestId: data.serviceRequestId,
      professionalProfileId: data.professionalProfileId,
      submittedByUserId: data.submittedByUserId,
      status: "SENT",
      totalAmount: data.totalAmount,
      currency: data.currency,
      validUntil: data.validUntil,
      notes: data.notes,
      items,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.quotes.set(record.id, record);
    return record;
  }
  async update(id: string, data: UpdateQuoteFields) {
    const existing = this.quotes.get(id)!;
    const items = data.items.map((item, index) => ({
      id: nextId("item"),
      description: item.description,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      amount: item.quantity * item.unitPrice,
      sortOrder: index,
      category: item.category ?? "LABOR",
    }));
    const updated = { ...existing, ...data, items, updatedAt: new Date() };
    this.quotes.set(id, updated);
    return updated;
  }
  async updateStatus(id: string, status: QuoteStatusValue) {
    const existing = this.quotes.get(id);
    if (existing) this.quotes.set(id, { ...existing, status });
  }
  async findExpirable() {
    return [];
  }
}

export class FakeJobRepository implements JobRepository {
  jobs = new Map<string, JobRecord>();

  async findById(id: string) {
    return this.jobs.get(id) ?? null;
  }
  async listForCustomer(customerId: string, options: ListJobsOptions) {
    return this.toSummaries([...this.jobs.values()].filter((j) => j.customerId === customerId), options);
  }
  async listForProfessional(professionalProfileId: string, options: ListJobsOptions) {
    return this.toSummaries(
      [...this.jobs.values()].filter((j) => j.professionalProfileId === professionalProfileId),
      options,
    );
  }
  async startWork(data: StartJobData) {
    const existing = this.jobs.get(data.jobId)!;
    const updated = { ...existing, status: "IN_PROGRESS" as const, startedAt: new Date(), startedByUserId: data.startedByUserId };
    this.jobs.set(data.jobId, updated);
    return updated;
  }
  async complete(data: CompleteJobData) {
    const existing = this.jobs.get(data.jobId)!;
    const updated = {
      ...existing,
      status: "COMPLETED" as const,
      completedAt: new Date(),
      completedByUserId: data.completedByUserId,
    };
    this.jobs.set(data.jobId, updated);
    return updated;
  }
  async cancel(data: CancelJobData) {
    const existing = this.jobs.get(data.jobId)!;
    const updated = {
      ...existing,
      status: "CANCELLED" as const,
      cancelledAt: new Date(),
      cancelledByUserId: data.cancelledByUserId,
      cancellationReason: data.reason,
      cancellationNote: data.note,
    };
    this.jobs.set(data.jobId, updated);
    return updated;
  }

  /** Test-setup helper — directly seeds a Job row (production code never
   *  needs a bare "insert a Job" method on this interface, see its own doc
   *  comment: Jobs are created only via QuoteAcceptanceRepository). */
  seed(job: Partial<JobRecord> & Pick<JobRecord, "customerId">): JobRecord {
    const record: JobRecord = {
      id: nextId("job"),
      serviceRequestId: nextId("sr"),
      quoteId: nextId("quote"),
      professionalProfileId: null,
      companyProfileId: null,
      status: "COMPLETED",
      startedAt: null,
      startedByUserId: null,
      completedAt: null,
      completedByUserId: null,
      cancelledAt: null,
      cancelledByUserId: null,
      cancellationReason: null,
      cancellationNote: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...job,
    };
    this.jobs.set(record.id, record);
    return record;
  }

  private toSummaries(jobs: JobRecord[], options: ListJobsOptions): JobSummary[] {
    return jobs.slice(options.offset, options.offset + options.limit).map((j) => ({
      id: j.id,
      serviceRequestId: j.serviceRequestId,
      serviceRequestTitle: "Service Request",
      status: j.status,
      startedAt: j.startedAt,
      completedAt: j.completedAt,
      counterpartyName: null,
      createdAt: j.createdAt,
    }));
  }
}

export class FakeAppointmentRepository implements AppointmentRepository {
  appointments = new Map<string, AppointmentDetailRecord>();
  /** `AppointmentDetailRecord` itself has no `customerId` field (ownership
   *  is only reachable via its `jobId` -> Job.customerId, same as the real
   *  Prisma implementation's join) — this index exists purely so this
   *  test double's `listForCustomer` can filter without needing a second
   *  fake repository injected into it. */
  customerIdByAppointmentId = new Map<string, string>();

  async findById(id: string) {
    return this.appointments.get(id) ?? null;
  }
  async listForCustomer(customerId: string, options: ListAppointmentsOptions) {
    return this.toSummaries(
      [...this.appointments.values()].filter((a) => this.customerIdByAppointmentId.get(a.id) === customerId),
      options,
    );
  }
  async listForProfessional(professionalProfileId: string, options: ListAppointmentsOptions) {
    return this.toSummaries(
      [...this.appointments.values()].filter((a) => a.professionalProfileId === professionalProfileId),
      options,
    );
  }
  async proposeTime(data: ProposeAppointmentTimeData) {
    const existing = this.appointments.get(data.appointmentId)!;
    const updated = { ...existing, proposedStart: data.proposedStart, proposedEnd: data.proposedEnd };
    this.appointments.set(data.appointmentId, updated);
    return updated;
  }
  async confirm(appointmentId: string) {
    const existing = this.appointments.get(appointmentId)!;
    const updated = { ...existing, status: "CONFIRMED" as const };
    this.appointments.set(appointmentId, updated);
    return updated;
  }
  async cancel(data: CancelAppointmentData) {
    const existing = this.appointments.get(data.appointmentId)!;
    const updated = { ...existing, status: "CANCELLED" as const, cancelledAt: new Date() };
    this.appointments.set(data.appointmentId, updated);
    return updated;
  }
  async complete(data: CompleteAppointmentData) {
    const existing = this.appointments.get(data.appointmentId)!;
    const updated = { ...existing, status: "COMPLETED" as const };
    this.appointments.set(data.appointmentId, updated);
    return updated;
  }
  async reschedule(data: RescheduleAppointmentData): Promise<RescheduleAppointmentResult> {
    const previous = this.appointments.get(data.appointmentId)!;
    const next = { ...previous, id: nextId("appt"), status: "PROPOSED" as const };
    this.appointments.set(next.id, next);
    return { previous, next };
  }

  /** Test-setup helper, same rationale as FakeJobRepository.seed.
   *  `customerId` is not part of `AppointmentDetailRecord` (see this
   *  class's own doc comment on `customerIdByAppointmentId`) — passed
   *  alongside the record here purely to populate that index. */
  seed(appointment: Partial<AppointmentDetailRecord> & { customerId: string }): AppointmentDetailRecord {
    const { customerId, ...overrides } = appointment;
    const record = {
      id: nextId("appt"),
      jobId: nextId("job"),
      serviceRequestId: nextId("sr"),
      quoteId: nextId("quote"),
      professionalProfileId: null,
      companyProfileId: null,
      addressId: nextId("addr"),
      status: "CONFIRMED",
      scheduledStart: new Date(),
      scheduledEnd: new Date(),
      proposedStart: null,
      proposedEnd: null,
      proposedByUserId: null,
      notes: null,
      cancelledAt: null,
      cancelledByUserId: null,
      cancellationReason: null,
      cancellationNote: null,
      rescheduledFromId: null,
      rescheduledToId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    } as AppointmentDetailRecord;
    this.appointments.set(record.id, record);
    this.customerIdByAppointmentId.set(record.id, customerId);
    return record;
  }

  private toSummaries(appointments: AppointmentDetailRecord[], options: ListAppointmentsOptions): AppointmentSummary[] {
    return appointments.slice(options.offset, options.offset + options.limit).map((a) => ({
      id: a.id,
      serviceRequestId: a.serviceRequestId,
      serviceRequestTitle: "Service Request",
      status: a.status,
      scheduledStart: a.scheduledStart,
      scheduledEnd: a.scheduledEnd,
      proposedStart: a.proposedStart,
      proposedEnd: a.proposedEnd,
      counterpartyName: null,
      createdAt: a.createdAt,
    }));
  }
}

export class FakeConversationRepository implements ConversationRepository {
  conversations = new Map<string, ConversationRecord>();

  async findById(id: string) {
    return this.conversations.get(id) ?? null;
  }
  async findByServiceRequestAndParticipants(serviceRequestId: string, userIdA: string, userIdB: string) {
    return (
      [...this.conversations.values()].find(
        (c) =>
          c.serviceRequestId === serviceRequestId &&
          c.members.some((m) => m.userId === userIdA) &&
          c.members.some((m) => m.userId === userIdB),
      ) ?? null
    );
  }
  async create(serviceRequestId: string, memberUserIds: [string, string]) {
    const record: ConversationRecord = {
      id: nextId("conv"),
      serviceRequestId,
      status: "ACTIVE",
      lastMessageAt: null,
      members: memberUserIds.map((userId) => ({ userId, joinedAt: new Date(), leftAt: null, lastReadAt: null })),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.conversations.set(record.id, record);
    return record;
  }
  async listForUser(userId: string): Promise<ConversationSummary[]> {
    return [...this.conversations.values()]
      .filter((c) => c.members.some((m) => m.userId === userId))
      .map((c) => ({
        ...c,
        lastMessagePreview: null,
        unreadCount: 0,
        serviceRequestTitle: "Service Request",
        otherParticipant: { userId: "other", name: null, image: null },
      }));
  }
  async markRead() {}
  async countUnreadForUser() {
    return 0;
  }
}

export class FakeMessageRepository implements MessageRepository {
  messages = new Map<string, MessageRecord>();

  async findById(id: string) {
    return this.messages.get(id) ?? null;
  }
  async create(data: CreateMessageData) {
    const record: MessageRecord = {
      id: nextId("msg"),
      conversationId: data.conversationId,
      senderId: data.senderId,
      body: data.body,
      status: "SENT",
      type: data.type ?? "USER",
      deletedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.messages.set(record.id, record);
    return record;
  }
  async listByConversation(conversationId: string, options: ListMessagesOptions) {
    return [...this.messages.values()].filter((m) => m.conversationId === conversationId).slice(0, options.limit);
  }
  async softDelete(id: string) {
    const existing = this.messages.get(id);
    if (existing) this.messages.set(id, { ...existing, status: "DELETED", deletedAt: new Date() });
  }
}

export class FakeNotificationRepository implements NotificationRepository {
  notifications = new Map<string, NotificationRecord>();

  async create(data: CreateNotificationData) {
    const record: NotificationRecord = {
      id: nextId("notif"),
      userId: data.userId,
      type: data.type,
      title: data.title,
      message: data.message,
      resourceType: data.resourceType,
      resourceId: data.resourceId,
      actionUrl: data.actionUrl,
      metadata: data.metadata,
      readAt: null,
      dismissedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.notifications.set(record.id, record);
    return record;
  }
  async findByIdForUser(id: string, userId: string) {
    const n = this.notifications.get(id);
    return n && n.userId === userId ? n : null;
  }
  async listForUser(userId: string, options: ListNotificationsOptions) {
    return [...this.notifications.values()]
      .filter((n) => n.userId === userId && n.dismissedAt === null)
      .slice(options.offset, options.offset + options.limit);
  }
  async countUnreadForUser(userId: string) {
    return [...this.notifications.values()].filter((n) => n.userId === userId && !n.readAt && !n.dismissedAt).length;
  }
  async markAsRead(id: string, userId: string) {
    const n = this.notifications.get(id);
    if (!n || n.userId !== userId) return null;
    const updated = { ...n, readAt: n.readAt ?? new Date() };
    this.notifications.set(id, updated);
    return updated;
  }
  async markAllAsRead() {}
  async dismiss(id: string, userId: string) {
    const n = this.notifications.get(id);
    if (!n || n.userId !== userId) return null;
    const updated = { ...n, dismissedAt: n.dismissedAt ?? new Date() };
    this.notifications.set(id, updated);
    return updated;
  }
}

export class FakeReviewRepository implements ReviewRepository {
  reviews = new Map<string, ReviewRecord>();

  async findById(id: string) {
    return this.reviews.get(id) ?? null;
  }
  async findByJobId(jobId: string) {
    return [...this.reviews.values()].find((r) => r.jobId === jobId) ?? null;
  }
  async listByProfessionalId(professionalProfileId: string, options: ListProfessionalReviewsOptions) {
    return [...this.reviews.values()]
      .filter((r) => r.revieweeProfessionalProfileId === professionalProfileId && r.status === "PUBLISHED")
      .slice(options.offset, options.offset + options.limit);
  }
  async getProfessionalRatingSummary(professionalProfileId: string): Promise<ProfessionalRatingSummary> {
    const published = [...this.reviews.values()].filter(
      (r) => r.revieweeProfessionalProfileId === professionalProfileId && r.status === "PUBLISHED",
    );
    const ratingDistribution: ProfessionalRatingSummary["ratingDistribution"] = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    let lastReviewAt: Date | null = null;
    for (const r of published) {
      ratingDistribution[r.rating as 1 | 2 | 3 | 4 | 5] += 1;
      if (!lastReviewAt || r.createdAt > lastReviewAt) lastReviewAt = r.createdAt;
    }
    return {
      professionalProfileId,
      averageRating: published.length ? published.reduce((sum, r) => sum + r.rating, 0) / published.length : null,
      reviewCount: published.length,
      ratingDistribution,
      lastReviewAt,
    };
  }
  async create(data: CreateReviewData) {
    const record: ReviewRecord = {
      id: nextId("review"),
      jobId: data.jobId,
      serviceRequestId: data.serviceRequestId,
      reviewerId: data.reviewerId,
      revieweeProfessionalProfileId: data.revieweeProfessionalProfileId,
      revieweeCompanyProfileId: data.revieweeCompanyProfileId,
      rating: data.rating,
      comment: data.comment,
      status: "PUBLISHED",
      response: null,
      respondedAt: null,
      deletedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.reviews.set(record.id, record);
    return record;
  }
  // Module 41 — Reviews & Ratings: not exercised by GDPR tests (this fake
  // only covers CreateReviewUseCase's own export/erasure interactions).
  async update(): Promise<never> {
    throw new Error("not used in gdpr tests");
  }
  async softDelete(): Promise<never> {
    throw new Error("not used in gdpr tests");
  }
  async respond(): Promise<never> {
    throw new Error("not used in gdpr tests");
  }
}

export class FakeSupportTicketRepository implements SupportTicketRepository {
  tickets = new Map<string, SupportTicketRecord>();

  async findById(id: string) {
    return this.tickets.get(id) ?? null;
  }
  async listOpenedByUser(userId: string, options: ListSupportTicketsOptions) {
    return [...this.tickets.values()]
      .filter((t) => t.openedByUserId === userId && (!options.status || t.status === options.status))
      .slice(options.offset, options.offset + options.limit);
  }
  async listForAdmin(options: ListAdminSupportTicketsOptions) {
    return [...this.tickets.values()].slice(options.offset, options.offset + options.limit);
  }
  async countAll() {
    return this.tickets.size;
  }
  async create(data: CreateSupportTicketData) {
    const record: SupportTicketRecord = {
      id: nextId("ticket"),
      ticketNumber: data.ticketNumber,
      category: data.category,
      subject: data.subject,
      description: data.description,
      status: "OPEN",
      priority: data.priority,
      openedByUserId: data.openedByUserId,
      assignedAdminUserId: null,
      resolutionNote: null,
      resolvedAt: null,
      resolvedByUserId: null,
      closedAt: null,
      closedByUserId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.tickets.set(record.id, record);
    return record;
  }
  async updateStatus(id: string, _expectedStatus: SupportTicketRecord["status"], data: Partial<SupportTicketRecord>) {
    const existing = this.tickets.get(id)!;
    const updated = { ...existing, ...data } as SupportTicketRecord;
    this.tickets.set(id, updated);
    return updated;
  }
  async assign(id: string, assignedAdminUserId: string | null) {
    const existing = this.tickets.get(id)!;
    const updated = { ...existing, assignedAdminUserId };
    this.tickets.set(id, updated);
    return updated;
  }
}

export class FakeDisputeRepository implements DisputeRepository {
  disputes = new Map<string, DisputeRecord>();

  async findById(id: string) {
    return this.disputes.get(id) ?? null;
  }
  async listByJobId(jobId: string) {
    return [...this.disputes.values()].filter((d) => d.jobId === jobId);
  }
  async listRaisedByUser(userId: string, options: ListDisputesOptions) {
    return [...this.disputes.values()]
      .filter((d) => d.raisedByUserId === userId && (!options.status || d.status === options.status))
      .slice(options.offset, options.offset + options.limit);
  }
  async listForAdmin(options: ListAdminDisputesOptions) {
    return [...this.disputes.values()].slice(options.offset, options.offset + options.limit);
  }
  async create(data: CreateDisputeData) {
    const record: DisputeRecord = {
      id: nextId("dispute"),
      caseNumber: nextId("DSP"),
      title: data.title,
      jobId: data.jobId,
      serviceRequestId: data.serviceRequestId,
      raisedByUserId: data.raisedByUserId,
      respondentProfessionalProfileId: data.respondentProfessionalProfileId,
      respondentCompanyProfileId: data.respondentCompanyProfileId,
      reason: data.reason,
      status: "OPEN",
      priority: data.priority,
      description: data.description,
      assignedAdminUserId: null,
      resolution: null,
      resolutionNote: null,
      resolvedAt: null,
      resolvedByUserId: null,
      closedAt: null,
      closedByUserId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.disputes.set(record.id, record);
    return record;
  }
  async updateStatus(id: string, _expectedStatus: DisputeRecord["status"], data: Partial<DisputeRecord>) {
    const existing = this.disputes.get(id)!;
    const updated = { ...existing, ...data } as DisputeRecord;
    this.disputes.set(id, updated);
    return updated;
  }
  async assign(id: string, assignedAdminUserId: string | null) {
    const existing = this.disputes.get(id)!;
    const updated = { ...existing, assignedAdminUserId };
    this.disputes.set(id, updated);
    return updated;
  }
  async setPriority(id: string, priority: DisputeRecord["priority"]) {
    const existing = this.disputes.get(id)!;
    const updated = { ...existing, priority };
    this.disputes.set(id, updated);
    return updated;
  }
}

export class FakeProfessionalVerificationRepository implements ProfessionalVerificationRepository {
  verifications = new Map<string, ProfessionalVerificationRecord>();
  documents = new Map<string, VerificationDocumentRecord[]>();

  async create(professionalProfileId: string) {
    const record: ProfessionalVerificationRecord = {
      id: nextId("verification"),
      professionalProfileId,
      status: "DRAFT",
      submittedAt: null,
      reviewedAt: null,
      reviewedByUserId: null,
      rejectionReason: null,
      resubmissionReason: null,
      expiresAt: null,
      provider: "MANUAL",
      providerVerificationId: null,
      providerStatus: null,
      providerSyncedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.verifications.set(record.id, record);
    return record;
  }
  async findActiveByProfessionalProfileId(professionalProfileId: string) {
    return [...this.verifications.values()].find((v) => v.professionalProfileId === professionalProfileId) ?? null;
  }
  async findActiveWithDocumentsByProfessionalProfileId(
    professionalProfileId: string,
  ): Promise<ProfessionalVerificationWithDocuments | null> {
    const verification = await this.findActiveByProfessionalProfileId(professionalProfileId);
    if (!verification) return null;
    return { ...verification, documents: this.documents.get(verification.id) ?? [] };
  }
  async findById(id: string) {
    return this.verifications.get(id) ?? null;
  }
  async updateStatus(id: string, data: UpdateVerificationStatusData) {
    const existing = this.verifications.get(id)!;
    const updated = { ...existing, ...data } as ProfessionalVerificationRecord;
    this.verifications.set(id, updated);
    return updated;
  }
  async addDocument(data: AddVerificationDocumentData) {
    const doc: VerificationDocumentRecord = {
      id: nextId("doc"),
      verificationId: data.verificationId,
      type: data.type,
      status: "PENDING",
      fileUrl: data.fileUrl,
      originalFilename: data.originalFilename,
      mimeType: data.mimeType,
      fileSizeBytes: data.fileSizeBytes,
      rejectionReason: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const list = this.documents.get(data.verificationId) ?? [];
    list.push(doc);
    this.documents.set(data.verificationId, list);
    return doc;
  }
  async findDocumentById(id: string) {
    for (const docs of this.documents.values()) {
      const found = docs.find((d) => d.id === id);
      if (found) return found;
    }
    return null;
  }
  async listDocuments(verificationId: string) {
    return this.documents.get(verificationId) ?? [];
  }
  async countDocuments(verificationId: string) {
    return this.documents.get(verificationId)?.length ?? 0;
  }
  async removeDocument(id: string) {
    for (const [key, docs] of this.documents.entries()) {
      this.documents.set(key, docs.filter((d) => d.id !== id));
    }
  }
  async setProfileVerificationStatus() {}
  async listForAdmin(): Promise<AdminVerificationListItem[]> {
    return [];
  }
  async getDetailForAdmin(): Promise<AdminVerificationDetail | null> {
    return null;
  }
  async findExpirable() {
    return [];
  }
  async findByProviderVerificationId() {
    return null;
  }
  async findSyncable() {
    return [];
  }
}

export class FakeConsentRepository implements ConsentRepository {
  consents = new Map<string, ConsentRecord>();

  async findActiveByUserAndType(userId: string, type: ConsentTypeValue) {
    return (
      [...this.consents.values()].find((c) => c.userId === userId && c.type === type && c.withdrawnAt === null) ??
      null
    );
  }
  async listByUser(userId: string) {
    return [...this.consents.values()]
      .filter((c) => c.userId === userId)
      .sort((a, b) => b.grantedAt.getTime() - a.grantedAt.getTime());
  }
  async create(data: CreateConsentData) {
    const record: ConsentRecord = {
      id: nextId("consent"),
      userId: data.userId,
      type: data.type,
      version: data.version,
      grantedAt: data.grantedAt,
      withdrawnAt: null,
      ipHash: data.ipHash ?? null,
      userAgent: data.userAgent ?? null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.consents.set(record.id, record);
    return record;
  }
  async withdraw(id: string, withdrawnAt: Date) {
    const existing = this.consents.get(id)!;
    if (existing.withdrawnAt) return existing;
    const updated = { ...existing, withdrawnAt, updatedAt: new Date() };
    this.consents.set(id, updated);
    return updated;
  }
}

export class FakeAdminAuditLogRepository implements AdminAuditLogRepository {
  entries: AdminAuditLogRecord[] = [];

  async record(data: RecordAdminAuditLogData) {
    const record: AdminAuditLogRecord = {
      id: nextId("audit"),
      adminUserId: data.adminUserId,
      action: data.action,
      targetType: data.targetType,
      targetId: data.targetId,
      metadata: data.metadata ?? null,
      createdAt: new Date(),
    };
    this.entries.push(record);
    return record;
  }
  async list(options: ListAdminAuditLogsOptions) {
    return [...this.entries]
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(options.offset, options.offset + options.limit);
  }
}
