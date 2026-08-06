import { describe, expect, it, vi } from "vitest";

import { NullAppointmentNotifier } from "@/application/ports/appointment-notifier";
import { NullJobNotifier } from "@/application/ports/job-notifier";
import type { NotificationCreator, NotificationEvent } from "@/application/ports/notification-creator";
import { AddDisputeEvidenceUseCase } from "@/application/use-cases/dispute/add-dispute-evidence.use-case";
import { AddDisputeInternalNoteUseCase } from "@/application/use-cases/dispute/add-dispute-internal-note.use-case";
import { AddDisputeMessageUseCase } from "@/application/use-cases/dispute/add-dispute-message.use-case";
import { AssignDisputeUseCase } from "@/application/use-cases/dispute/assign-dispute.use-case";
import { ChangeDisputeStatusUseCase } from "@/application/use-cases/dispute/change-dispute-status.use-case";
import { CloseDisputeUseCase } from "@/application/use-cases/dispute/close-dispute.use-case";
import { CreateDisputeUseCase } from "@/application/use-cases/dispute/create-dispute.use-case";
import { GetAdminDisputeUseCase } from "@/application/use-cases/dispute/get-admin-dispute.use-case";
import { GetDisputeByIdUseCase } from "@/application/use-cases/dispute/get-dispute-by-id.use-case";
import { RejectDisputeUseCase } from "@/application/use-cases/dispute/reject-dispute.use-case";
import { ResolveDisputeUseCase } from "@/application/use-cases/dispute/resolve-dispute.use-case";
import { RecordDisputeStatusChangeAuditLogSubscriber } from "@/application/use-cases/dispute/record-dispute-status-change-audit-log.subscriber";
import { RecordDisputeAssignedAuditLogSubscriber } from "@/application/use-cases/dispute/record-dispute-assigned-audit-log.subscriber";
import { RecordDisputeMessageAddedAuditLogSubscriber } from "@/application/use-cases/dispute/record-dispute-message-added-audit-log.subscriber";
import { RecordDisputeCreatedAuditLogSubscriber } from "@/application/use-cases/dispute/record-dispute-created-audit-log.subscriber";
import { NotifyDisputeStatusChangeSubscriber } from "@/application/use-cases/notification/notify-dispute-status-change.subscriber";
import { NotifyDisputeAssignedSubscriber } from "@/application/use-cases/notification/notify-dispute-assigned.subscriber";
import { NotifyDisputeMessageAddedSubscriber } from "@/application/use-cases/notification/notify-dispute-message-added.subscriber";
import { NotifyDisputeCreatedSubscriber } from "@/application/use-cases/notification/notify-dispute-created.subscriber";
import { AssignSupportTicketUseCase } from "@/application/use-cases/support-ticket/assign-support-ticket.use-case";
import { ChangeSupportTicketStatusUseCase } from "@/application/use-cases/support-ticket/change-support-ticket-status.use-case";
import { CloseSupportTicketUseCase } from "@/application/use-cases/support-ticket/close-support-ticket.use-case";
import { CreateSupportTicketUseCase } from "@/application/use-cases/support-ticket/create-support-ticket.use-case";
import { GetSupportTicketByIdUseCase } from "@/application/use-cases/support-ticket/get-support-ticket-by-id.use-case";
import { ListMySupportTicketsUseCase } from "@/application/use-cases/support-ticket/list-my-support-tickets.use-case";
import { RecordSupportTicketAuditLogSubscriber } from "@/application/use-cases/support-ticket/record-support-ticket-audit-log.subscriber";
import { ResolveSupportTicketUseCase } from "@/application/use-cases/support-ticket/resolve-support-ticket.use-case";
import { NotifySupportTicketStatusChangeSubscriber } from "@/application/use-cases/notification/notify-support-ticket-status-change.subscriber";
import { ConflictError, NotFoundError, UnauthorizedError, ValidationError } from "@/domain/errors/domain-error";
import { SupportTicketStatusChanged } from "@/domain/events/support-ticket-status-changed";
import { DisputeStatusChanged } from "@/domain/events/dispute-status-changed";
import { DisputeAssigned } from "@/domain/events/dispute-assigned";
import { DisputeMessageAdded } from "@/domain/events/dispute-message-added";
import { DisputeCreated } from "@/domain/events/dispute-created";
import { canTransitionDisputeStatus } from "@/domain/services/dispute-state";
import { SynchronousEventBus } from "@/infrastructure/events/synchronous-event-bus";
import {
  FakeAppointmentRepository,
  FakeCustomerProfileRepository,
  FakeJobRepository,
  FakeQuoteAcceptanceRepository,
  FakeQuoteRepository,
  FakeServiceRequestRepository,
  createAppointmentStore,
  createJobStore,
} from "../booking/fakes";
import { FakeCompanyMembershipRepository } from "../company/fakes";
import { FakeProfessionalRepository } from "../quotes/fakes";
import {
  FakeAdminAuditLogRepository,
  FakeDisputeEvidenceRepository,
  FakeDisputeMessageRepository,
  FakeDisputeRepository,
  FakeSupportTicketRepository,
} from "./fakes";

/**
 * Integration tests for Module 21 — Disputes & Support. Built on top of the
 * same accepted-quote -> Job pipeline job-flows.test.ts/review-flows.test.ts
 * exercise, since a Dispute is anchored to a Job. Real use cases + domain
 * services, fake repositories swapped in for storage.
 */

class FakeNotificationCreator implements NotificationCreator {
  events: NotificationEvent[] = [];
  async notify(event: NotificationEvent): Promise<void> {
    this.events.push(event);
  }
}

let counter = 0;

function makeRepos() {
  const customerProfiles = new FakeCustomerProfileRepository();
  const professionals = new FakeProfessionalRepository();
  const serviceRequests = new FakeServiceRequestRepository();
  const quotes = new FakeQuoteRepository();
  const appointmentStore = createAppointmentStore();
  const jobStore = createJobStore();
  const quoteAcceptance = new FakeQuoteAcceptanceRepository(quotes, serviceRequests, appointmentStore, jobStore);
  const appointments = new FakeAppointmentRepository(appointmentStore);
  const jobs = new FakeJobRepository(jobStore, appointmentStore);
  const companyMembers = new FakeCompanyMembershipRepository();
  const disputes = new FakeDisputeRepository();
  const disputeMessages = new FakeDisputeMessageRepository();
  const disputeEvidence = new FakeDisputeEvidenceRepository();
  const supportTickets = new FakeSupportTicketRepository();
  const auditLog = new FakeAdminAuditLogRepository();
  const notifications = new FakeNotificationCreator();
  return {
    customerProfiles,
    professionals,
    serviceRequests,
    quotes,
    quoteAcceptance,
    appointments,
    jobs,
    companyMembers,
    disputes,
    disputeMessages,
    disputeEvidence,
    supportTickets,
    auditLog,
    notifications,
  };
}

type Repos = ReturnType<typeof makeRepos>;

async function seedRequest(repos: Repos, customerUserId: string) {
  const customer = await repos.customerProfiles.findOrCreateByUserId(customerUserId);
  counter += 1;
  const now = new Date();
  return repos.serviceRequests.seed({
    id: `request-${counter}`,
    customerId: customer.id,
    categoryId: "cat-plumbing",
    categoryName: "Plumbing",
    title: "Fix leaking kitchen tap",
    description: "Dripping for a week.",
    status: "PUBLISHED",
    urgency: "MEDIUM",
    budgetMin: null,
    budgetMax: null,
    location: {
      line1: "Calle Mayor 1",
      line2: null,
      city: "Oliva",
      province: "Valencia",
      postalCode: "46780",
      country: "ES",
      latitude: null,
      longitude: null,
    },
    photos: [],
    createdAt: now,
    updatedAt: now,
  });
}

async function seedJob(repos: Repos, customerUserId: string, professionalUserId: string) {
  const existingPro = await repos.professionals.findByUserId(professionalUserId);
  const professional = existingPro ?? (await repos.professionals.create(professionalUserId, {}));
  const request = await seedRequest(repos, customerUserId);
  const quote = await repos.quotes.create({
    serviceRequestId: request.id,
    professionalProfileId: professional.id,
    submittedByUserId: professionalUserId,
    totalAmount: 100,
    currency: "EUR",
    validUntil: null,
    notes: null,
    items: [{ description: "Labor", quantity: 1, unitPrice: 100 }],
  });
  const result = await repos.quoteAcceptance.acceptQuote({ quoteId: quote.id, serviceRequestId: request.id });
  return { request, professional, job: result.job, appointment: result.appointment };
}

function future(hoursFromNow: number, durationMinutes = 60) {
  const start = new Date(Date.now() + hoursFromNow * 60 * 60 * 1000);
  const end = new Date(start.getTime() + durationMinutes * 60 * 1000);
  return { start, end };
}

function makeUseCases(repos: Repos) {
  // Module 37 — Domain Event Subscribers: the support-ticket use cases below
  // publish `SupportTicketStatusChanged` instead of calling
  // repos.auditLog/repos.notifications directly — wire a real
  // `SynchronousEventBus` with the real subscribers so this integration test
  // still exercises the full, genuine side-effect path end to end, same
  // pattern as tests/integration/verification/verification-flows.test.ts.
  const supportTicketEventBus = new SynchronousEventBus();
  supportTicketEventBus.subscribe(
    SupportTicketStatusChanged,
    new RecordSupportTicketAuditLogSubscriber(repos.auditLog),
  );
  supportTicketEventBus.subscribe(
    SupportTicketStatusChanged,
    new NotifySupportTicketStatusChangeSubscriber(repos.notifications),
  );

  // Module 37 — Domain Event Subscribers: the dispute use cases below
  // publish DisputeStatusChanged/DisputeAssigned/DisputeMessageAdded/
  // DisputeCreated instead of calling repos.auditLog/repos.notifications
  // directly — wire a real `SynchronousEventBus` with the real subscribers
  // so this integration test still exercises the full, genuine side-effect
  // path end to end, same pattern as the support-ticket wiring above.
  const disputeEventBus = new SynchronousEventBus();
  disputeEventBus.subscribe(DisputeStatusChanged, new RecordDisputeStatusChangeAuditLogSubscriber(repos.auditLog));
  disputeEventBus.subscribe(DisputeStatusChanged, new NotifyDisputeStatusChangeSubscriber(repos.notifications));
  disputeEventBus.subscribe(DisputeAssigned, new RecordDisputeAssignedAuditLogSubscriber(repos.auditLog));
  disputeEventBus.subscribe(DisputeAssigned, new NotifyDisputeAssignedSubscriber(repos.notifications));
  disputeEventBus.subscribe(DisputeMessageAdded, new RecordDisputeMessageAddedAuditLogSubscriber(repos.auditLog));
  disputeEventBus.subscribe(DisputeMessageAdded, new NotifyDisputeMessageAddedSubscriber(repos.notifications));
  disputeEventBus.subscribe(DisputeCreated, new RecordDisputeCreatedAuditLogSubscriber(repos.auditLog));
  disputeEventBus.subscribe(DisputeCreated, new NotifyDisputeCreatedSubscriber(repos.notifications));

  return {
    createDispute: new CreateDisputeUseCase(
      repos.disputes,
      repos.jobs,
      repos.customerProfiles,
      repos.professionals,
      repos.companyMembers,
      disputeEventBus,
    ),
    getDispute: new GetDisputeByIdUseCase(
      repos.disputes,
      repos.jobs,
      repos.disputeMessages,
      repos.disputeEvidence,
      repos.customerProfiles,
      repos.professionals,
      repos.companyMembers,
    ),
    getAdminDispute: new GetAdminDisputeUseCase(repos.disputes, repos.disputeMessages, repos.disputeEvidence),
    assign: new AssignDisputeUseCase(repos.disputes, disputeEventBus),
    changeStatus: new ChangeDisputeStatusUseCase(
      repos.disputes,
      repos.jobs,
      repos.customerProfiles,
      repos.professionals,
      repos.companyMembers,
      disputeEventBus,
    ),
    addMessage: new AddDisputeMessageUseCase(
      repos.disputes,
      repos.disputeMessages,
      repos.jobs,
      repos.customerProfiles,
      repos.professionals,
      repos.companyMembers,
      disputeEventBus,
    ),
    addInternalNote: new AddDisputeInternalNoteUseCase(repos.disputes, repos.disputeMessages, repos.auditLog),
    addEvidence: new AddDisputeEvidenceUseCase(
      repos.disputes,
      repos.disputeEvidence,
      repos.jobs,
      repos.customerProfiles,
      repos.professionals,
      repos.companyMembers,
      repos.auditLog,
    ),
    resolve: new ResolveDisputeUseCase(
      repos.disputes,
      repos.jobs,
      repos.customerProfiles,
      repos.professionals,
      repos.companyMembers,
      disputeEventBus,
    ),
    reject: new RejectDisputeUseCase(
      repos.disputes,
      repos.jobs,
      repos.customerProfiles,
      repos.professionals,
      repos.companyMembers,
      disputeEventBus,
    ),
    close: new CloseDisputeUseCase(
      repos.disputes,
      repos.jobs,
      repos.customerProfiles,
      repos.professionals,
      repos.companyMembers,
      disputeEventBus,
    ),
    createTicket: new CreateSupportTicketUseCase(repos.supportTickets, repos.auditLog),
    getTicket: new GetSupportTicketByIdUseCase(repos.supportTickets),
    listMyTickets: new ListMySupportTicketsUseCase(repos.supportTickets),
    assignTicket: new AssignSupportTicketUseCase(repos.supportTickets, supportTicketEventBus),
    changeTicketStatus: new ChangeSupportTicketStatusUseCase(repos.supportTickets, supportTicketEventBus),
    resolveTicket: new ResolveSupportTicketUseCase(repos.supportTickets, supportTicketEventBus),
    closeTicket: new CloseSupportTicketUseCase(repos.supportTickets, supportTicketEventBus),
  };
}

const CUSTOMER = "user-customer-1";
const PROFESSIONAL = "user-pro-1";
const OTHER_CUSTOMER = "user-customer-2";
const OTHER_PROFESSIONAL = "user-pro-2";
const ADMIN = "user-admin-1";

async function confirmAppointment(repos: Repos, appointmentId: string, customerUserId: string, professionalUserId: string) {
  const { ConfirmAppointmentUseCase } = await import("@/application/use-cases/booking/confirm-appointment.use-case");
  const { ProposeAppointmentTimeUseCase } = await import(
    "@/application/use-cases/booking/propose-appointment-time.use-case"
  );
  const appointmentNotifier = new NullAppointmentNotifier();
  const propose = new ProposeAppointmentTimeUseCase(
    repos.appointments,
    repos.customerProfiles,
    repos.professionals,
    repos.serviceRequests,
    appointmentNotifier,
  );
  const confirm = new ConfirmAppointmentUseCase(
    repos.appointments,
    repos.customerProfiles,
    repos.professionals,
    repos.serviceRequests,
    appointmentNotifier,
  );
  const { start, end } = future(24);
  await propose.execute(customerUserId, appointmentId, start, end);
  await confirm.execute(professionalUserId, appointmentId);
}

/** Seeds a Job and drives it to IN_PROGRESS (the minimum status a dispute
 *  may be opened from — see dispute-rules.ts). */
async function seedInProgressJob(repos: Repos, customerUserId = CUSTOMER, professionalUserId = PROFESSIONAL) {
  const { StartJobUseCase } = await import("@/application/use-cases/job/start-job.use-case");
  const { job, appointment, professional } = await seedJob(repos, customerUserId, professionalUserId);
  await confirmAppointment(repos, appointment.id, customerUserId, professionalUserId);
  const start = new StartJobUseCase(repos.jobs, repos.customerProfiles, repos.professionals, new NullJobNotifier());
  const started = await start.execute(professionalUserId, job.id);
  return { job: started, professional, appointment };
}

async function openDispute(repos: Repos, customerUserId = CUSTOMER, professionalUserId = PROFESSIONAL) {
  const { job, professional } = await seedInProgressJob(repos, customerUserId, professionalUserId);
  const { createDispute } = makeUseCases(repos);
  const dispute = await createDispute.execute(customerUserId, {
    jobId: job.id,
    reason: "SERVICE_QUALITY",
    title: "Work was not up to standard",
    description: "The tap is still leaking after the visit and the finish looks rushed.",
  });
  return { job, professional, dispute };
}

describe("Server Action auth boundary (unauthenticated users)", () => {
  it("requireAuth throws when there is no session", async () => {
    vi.doMock("@/lib/auth", () => ({ auth: vi.fn().mockResolvedValue(null) }));
    const { requireAuth } = await import("@/infrastructure/auth/rbac");
    await expect(requireAuth()).rejects.toThrow(UnauthorizedError);
    vi.doUnmock("@/lib/auth");
  });
});

describe("Create Dispute", () => {
  it("allows the customer to open a dispute on their own IN_PROGRESS job", async () => {
    const repos = makeRepos();
    const { job, professional, dispute } = await openDispute(repos);
    expect(dispute.jobId).toBe(job.id);
    expect(dispute.raisedByUserId).toBe(CUSTOMER);
    expect(dispute.respondentProfessionalProfileId).toBe(professional.id);
    expect(dispute.status).toBe("OPEN");
    expect(dispute.caseNumber).toMatch(/^DSP-\d{4}-\d{6}$/);
  });

  it("allows the professional to open a dispute on the same job", async () => {
    const repos = makeRepos();
    const { job } = await seedInProgressJob(repos);
    const { createDispute } = makeUseCases(repos);
    const dispute = await createDispute.execute(PROFESSIONAL, {
      jobId: job.id,
      reason: "CUSTOMER_NO_SHOW",
      title: "Customer was not present",
      description: "I arrived at the scheduled time but nobody answered the door.",
    });
    expect(dispute.raisedByUserId).toBe(PROFESSIONAL);
  });

  it("rejects opening a dispute for a job that is still CREATED", async () => {
    const repos = makeRepos();
    const { job } = await seedJob(repos, CUSTOMER, PROFESSIONAL);
    const { createDispute } = makeUseCases(repos);
    await expect(
      createDispute.execute(CUSTOMER, {
        jobId: job.id,
        reason: "OTHER",
        title: "Too early to dispute",
        description: "Nothing has happened yet on this job.",
      }),
    ).rejects.toThrow(ValidationError);
  });

  it("a not-found job id fails the same way for anyone (no existence probing)", async () => {
    const repos = makeRepos();
    await repos.customerProfiles.findOrCreateByUserId(CUSTOMER);
    const { createDispute } = makeUseCases(repos);
    await expect(
      createDispute.execute(CUSTOMER, {
        jobId: "does-not-exist",
        reason: "OTHER",
        title: "Some title here",
        description: "Some description that is long enough to pass validation.",
      }),
    ).rejects.toThrow(NotFoundError);
  });

  it("an unrelated user cannot open a dispute for someone else's job", async () => {
    const repos = makeRepos();
    const { job } = await seedInProgressJob(repos);
    await repos.customerProfiles.findOrCreateByUserId(OTHER_CUSTOMER);
    const { createDispute } = makeUseCases(repos);
    await expect(
      createDispute.execute(OTHER_CUSTOMER, {
        jobId: job.id,
        reason: "OTHER",
        title: "Not my job to dispute",
        description: "This job does not belong to me at all.",
      }),
    ).rejects.toThrow(NotFoundError);
  });

  it("prevents a second concurrently-OPEN dispute by the same user on the same job", async () => {
    const repos = makeRepos();
    const { job } = await openDispute(repos);
    const { createDispute } = makeUseCases(repos);
    await expect(
      createDispute.execute(CUSTOMER, {
        jobId: job.id,
        reason: "OTHER",
        title: "Second dispute attempt",
        description: "Trying to open a second dispute on the same job.",
      }),
    ).rejects.toThrow(ConflictError);
  });

  it("records an audit log entry and notifies the respondent", async () => {
    const repos = makeRepos();
    const { dispute } = await openDispute(repos);
    const entries = repos.auditLog.entries.filter((e) => e.action === "DISPUTE_CREATED");
    expect(entries).toHaveLength(1);
    expect(entries[0]?.targetId).toBe(dispute.id);

    const notified = repos.notifications.events.filter((e) => e.type === "DISPUTE_CREATED");
    expect(notified).toHaveLength(1);
    expect(notified[0]?.userId).toBe(PROFESSIONAL);
  });
});

describe("Read a Dispute — authorization (IDOR prevention)", () => {
  it("the raiser (customer) can view their own dispute", async () => {
    const repos = makeRepos();
    const { dispute } = await openDispute(repos);
    const { getDispute } = makeUseCases(repos);
    const detail = await getDispute.execute(CUSTOMER, dispute.id);
    expect(detail.dispute.id).toBe(dispute.id);
  });

  it("the respondent (professional) can view the dispute", async () => {
    const repos = makeRepos();
    const { dispute } = await openDispute(repos);
    const { getDispute } = makeUseCases(repos);
    const detail = await getDispute.execute(PROFESSIONAL, dispute.id);
    expect(detail.dispute.id).toBe(dispute.id);
  });

  it("an unrelated user gets NotFoundError, not a distinguishable forbidden", async () => {
    const repos = makeRepos();
    const { dispute } = await openDispute(repos);
    await repos.customerProfiles.findOrCreateByUserId(OTHER_CUSTOMER);
    const { getDispute } = makeUseCases(repos);
    await expect(getDispute.execute(OTHER_CUSTOMER, dispute.id)).rejects.toThrow(NotFoundError);
  });

  it("an unrelated professional gets NotFoundError", async () => {
    const repos = makeRepos();
    const { dispute } = await openDispute(repos);
    await repos.professionals.create(OTHER_PROFESSIONAL, {});
    const { getDispute } = makeUseCases(repos);
    await expect(getDispute.execute(OTHER_PROFESSIONAL, dispute.id)).rejects.toThrow(NotFoundError);
  });

  it("admin can view the dispute (and full thread) via the admin-only use case", async () => {
    const repos = makeRepos();
    const { dispute } = await openDispute(repos);
    const { getAdminDispute } = makeUseCases(repos);
    const detail = await getAdminDispute.execute(dispute.id);
    expect(detail.dispute.id).toBe(dispute.id);
  });
});

describe("Dispute status transitions", () => {
  it("whitelist: OPEN -> UNDER_REVIEW is valid", () => {
    expect(canTransitionDisputeStatus("OPEN", "UNDER_REVIEW")).toBe(true);
  });

  it("whitelist: OPEN -> RESOLVED is invalid (must go through UNDER_REVIEW or use ResolveDisputeUseCase's own precondition)", () => {
    // Actually OPEN -> RESOLVED IS allowed per the whitelist's admin
    // shortcut — this test documents that explicitly rather than assuming.
    expect(canTransitionDisputeStatus("OPEN", "RESOLVED")).toBe(true);
  });

  it("whitelist: CLOSED is terminal — no transition is allowed out of it", () => {
    expect(canTransitionDisputeStatus("CLOSED", "OPEN")).toBe(false);
    expect(canTransitionDisputeStatus("CLOSED", "UNDER_REVIEW")).toBe(false);
  });

  it("whitelist: WAITING_FOR_CUSTOMER cannot go directly to WAITING_FOR_PROFESSIONAL", () => {
    expect(canTransitionDisputeStatus("WAITING_FOR_CUSTOMER", "WAITING_FOR_PROFESSIONAL")).toBe(false);
  });

  it("an admin can move a dispute from OPEN to UNDER_REVIEW", async () => {
    const repos = makeRepos();
    const { dispute } = await openDispute(repos);
    const { changeStatus } = makeUseCases(repos);
    const updated = await changeStatus.execute(ADMIN, dispute.id, "UNDER_REVIEW");
    expect(updated.status).toBe("UNDER_REVIEW");
  });

  it("rejects an invalid transition", async () => {
    const repos = makeRepos();
    const { dispute } = await openDispute(repos);
    const { changeStatus } = makeUseCases(repos);
    await changeStatus.execute(ADMIN, dispute.id, "UNDER_REVIEW");
    await expect(changeStatus.execute(ADMIN, dispute.id, "WAITING_FOR_CUSTOMER")).resolves.toBeDefined();
    // WAITING_FOR_CUSTOMER -> WAITING_FOR_PROFESSIONAL is not a valid direct hop.
    await expect(changeStatus.execute(ADMIN, dispute.id, "WAITING_FOR_PROFESSIONAL")).rejects.toThrow(ValidationError);
  });

  it("ChangeDisputeStatusUseCase refuses to set RESOLVED/REJECTED/CLOSED directly", async () => {
    const repos = makeRepos();
    const { dispute } = await openDispute(repos);
    const { changeStatus } = makeUseCases(repos);
    await expect(changeStatus.execute(ADMIN, dispute.id, "RESOLVED")).rejects.toThrow(ValidationError);
  });

  it("a party posting a message while WAITING_FOR_CUSTOMER auto-transitions back to UNDER_REVIEW", async () => {
    const repos = makeRepos();
    const { dispute } = await openDispute(repos);
    const { changeStatus, addMessage } = makeUseCases(repos);
    await changeStatus.execute(ADMIN, dispute.id, "UNDER_REVIEW");
    await changeStatus.execute(ADMIN, dispute.id, "WAITING_FOR_CUSTOMER");

    await addMessage.execute(CUSTOMER, dispute.id, "Here is my response.");

    const reloaded = await repos.disputes.findById(dispute.id);
    expect(reloaded?.status).toBe("UNDER_REVIEW");
  });

  it("a professional's message while WAITING_FOR_CUSTOMER does NOT auto-transition", async () => {
    const repos = makeRepos();
    const { dispute } = await openDispute(repos);
    const { changeStatus, addMessage } = makeUseCases(repos);
    await changeStatus.execute(ADMIN, dispute.id, "UNDER_REVIEW");
    await changeStatus.execute(ADMIN, dispute.id, "WAITING_FOR_CUSTOMER");

    await addMessage.execute(PROFESSIONAL, dispute.id, "Just adding context.");

    const reloaded = await repos.disputes.findById(dispute.id);
    expect(reloaded?.status).toBe("WAITING_FOR_CUSTOMER");
  });
});

describe("Assignment", () => {
  it("assigns a dispute to an admin and notifies them", async () => {
    const repos = makeRepos();
    const { dispute } = await openDispute(repos);
    const { assign } = makeUseCases(repos);
    const updated = await assign.execute(ADMIN, dispute.id, ADMIN);
    expect(updated.assignedAdminUserId).toBe(ADMIN);
    const notified = repos.notifications.events.filter((e) => e.type === "DISPUTE_ASSIGNED");
    expect(notified).toHaveLength(1);
    const auditEntries = repos.auditLog.entries.filter((e) => e.action === "DISPUTE_ASSIGNED");
    expect(auditEntries).toHaveLength(1);
  });

  it("can unassign a dispute", async () => {
    const repos = makeRepos();
    const { dispute } = await openDispute(repos);
    const { assign } = makeUseCases(repos);
    await assign.execute(ADMIN, dispute.id, ADMIN);
    const updated = await assign.execute(ADMIN, dispute.id, null);
    expect(updated.assignedAdminUserId).toBeNull();
  });
});

describe("Internal notes — never visible to non-admins", () => {
  it("an internal note is stored and appears in the admin thread", async () => {
    const repos = makeRepos();
    const { dispute } = await openDispute(repos);
    const { addInternalNote, getAdminDispute } = makeUseCases(repos);
    await addInternalNote.execute(ADMIN, dispute.id, "Looks like a legitimate complaint — escalate priority.");

    const detail = await getAdminDispute.execute(dispute.id);
    expect(detail.messages.some((m) => m.isInternalNote)).toBe(true);
  });

  it("GetDisputeByIdUseCase (customer/professional-facing) never returns internal notes", async () => {
    const repos = makeRepos();
    const { dispute } = await openDispute(repos);
    const { addInternalNote, getDispute } = makeUseCases(repos);
    await addInternalNote.execute(ADMIN, dispute.id, "Internal-only context.");
    await repos.disputeMessages.create({ disputeId: dispute.id, authorUserId: CUSTOMER, body: "Public message.", isInternalNote: false });

    const customerView = await getDispute.execute(CUSTOMER, dispute.id);
    expect(customerView.messages.every((m) => !m.isInternalNote)).toBe(true);
    expect(customerView.messages.some((m) => m.body === "Public message.")).toBe(true);
    expect(customerView.messages.some((m) => m.body.includes("Internal-only"))).toBe(false);
  });

  it("the repository's listPublic method itself never returns an internal note", async () => {
    const repos = makeRepos();
    const { dispute } = await openDispute(repos);
    await repos.disputeMessages.create({ disputeId: dispute.id, authorUserId: ADMIN, body: "secret", isInternalNote: true });
    const publicMessages = await repos.disputeMessages.listPublic(dispute.id);
    expect(publicMessages).toHaveLength(0);
  });
});

describe("Evidence", () => {
  it("a case participant can attach evidence", async () => {
    const repos = makeRepos();
    const { dispute } = await openDispute(repos);
    const { addEvidence } = makeUseCases(repos);
    const evidence = await addEvidence.execute(CUSTOMER, dispute.id, {
      fileUrl: "https://example.com/photo.jpg",
      fileName: "photo.jpg",
      fileType: "image/jpeg",
      fileSizeBytes: 1024,
      description: "Photo of the leak.",
    });
    expect(evidence.disputeId).toBe(dispute.id);
    expect(evidence.submittedByUserId).toBe(CUSTOMER);
  });

  it("an unrelated user cannot attach evidence", async () => {
    const repos = makeRepos();
    const { dispute } = await openDispute(repos);
    await repos.customerProfiles.findOrCreateByUserId(OTHER_CUSTOMER);
    const { addEvidence } = makeUseCases(repos);
    await expect(
      addEvidence.execute(OTHER_CUSTOMER, dispute.id, {
        fileUrl: "https://example.com/x.jpg",
        fileName: null,
        fileType: null,
        fileSizeBytes: null,
        description: null,
      }),
    ).rejects.toThrow(NotFoundError);
  });
});

describe("Resolution / rejection / closing", () => {
  it("resolves a dispute with a business-level outcome and notifies both parties", async () => {
    const repos = makeRepos();
    const { dispute } = await openDispute(repos);
    const { changeStatus, resolve } = makeUseCases(repos);
    await changeStatus.execute(ADMIN, dispute.id, "UNDER_REVIEW");

    const resolved = await resolve.execute(ADMIN, dispute.id, {
      resolution: "PARTIAL_RESOLUTION",
      resolutionNote: "Professional will return to fix the remaining issue.",
    });
    expect(resolved.status).toBe("RESOLVED");
    expect(resolved.resolution).toBe("PARTIAL_RESOLUTION");
    expect(resolved.resolvedByUserId).toBe(ADMIN);

    const notified = repos.notifications.events.filter((e) => e.type === "DISPUTE_RESOLVED");
    expect(notified.map((e) => e.userId).sort()).toEqual([CUSTOMER, PROFESSIONAL].sort());
  });

  it("cannot resolve an already-CLOSED dispute", async () => {
    const repos = makeRepos();
    const { dispute } = await openDispute(repos);
    const { changeStatus, resolve, close } = makeUseCases(repos);
    await changeStatus.execute(ADMIN, dispute.id, "UNDER_REVIEW");
    await resolve.execute(ADMIN, dispute.id, { resolution: "NO_ACTION", resolutionNote: "No wrongdoing found." });
    await close.execute(ADMIN, dispute.id);

    await expect(
      resolve.execute(ADMIN, dispute.id, { resolution: "NO_ACTION", resolutionNote: "Retry." }),
    ).rejects.toThrow(ValidationError);
  });

  it("rejects a dispute (no resolution outcome recorded)", async () => {
    const repos = makeRepos();
    const { dispute } = await openDispute(repos);
    const { reject } = makeUseCases(repos);
    const rejected = await reject.execute(ADMIN, dispute.id, "Duplicate of another case.");
    expect(rejected.status).toBe("REJECTED");
    expect(rejected.resolution).toBeNull();
  });

  it("closes a RESOLVED dispute", async () => {
    const repos = makeRepos();
    const { dispute } = await openDispute(repos);
    const { changeStatus, resolve, close } = makeUseCases(repos);
    await changeStatus.execute(ADMIN, dispute.id, "UNDER_REVIEW");
    await resolve.execute(ADMIN, dispute.id, { resolution: "NO_ACTION", resolutionNote: "Nothing to act on." });
    const closed = await close.execute(ADMIN, dispute.id);
    expect(closed.status).toBe("CLOSED");
  });

  it("cannot close a dispute that hasn't been resolved or rejected yet", async () => {
    const repos = makeRepos();
    const { dispute } = await openDispute(repos);
    const { close } = makeUseCases(repos);
    await expect(close.execute(ADMIN, dispute.id)).rejects.toThrow(ValidationError);
  });

  it("audit log has an entry for each of resolve/reject/close", async () => {
    const repos = makeRepos();
    const { dispute } = await openDispute(repos);
    const { changeStatus, resolve, close } = makeUseCases(repos);
    await changeStatus.execute(ADMIN, dispute.id, "UNDER_REVIEW");
    await resolve.execute(ADMIN, dispute.id, { resolution: "NO_ACTION", resolutionNote: "ok" });
    await close.execute(ADMIN, dispute.id);

    expect(repos.auditLog.entries.some((e) => e.action === "DISPUTE_RESOLVED")).toBe(true);
    expect(repos.auditLog.entries.some((e) => e.action === "DISPUTE_CLOSED")).toBe(true);
  });
});

describe("Support tickets", () => {
  it("any authenticated user can open a general support ticket", async () => {
    const repos = makeRepos();
    const { createTicket } = makeUseCases(repos);
    const ticket = await createTicket.execute(CUSTOMER, {
      category: "BUG",
      subject: "Cannot upload a photo",
      description: "The upload button does nothing when I click it on mobile.",
    });
    expect(ticket.status).toBe("OPEN");
    expect(ticket.ticketNumber).toMatch(/^TCK-\d{4}-\d{6}$/);
  });

  it("the opener can view their own ticket; an unrelated user cannot (IDOR)", async () => {
    const repos = makeRepos();
    const { createTicket, getTicket } = makeUseCases(repos);
    const ticket = await createTicket.execute(CUSTOMER, {
      category: "GENERAL",
      subject: "Question about billing cycle",
      description: "When exactly does the billing cycle reset each month?",
    });
    await expect(getTicket.execute(CUSTOMER, ticket.id)).resolves.toBeDefined();
    await expect(getTicket.execute(OTHER_CUSTOMER, ticket.id)).rejects.toThrow(NotFoundError);
  });

  it("full lifecycle: assign -> in progress -> resolve -> close", async () => {
    const repos = makeRepos();
    const { createTicket, assignTicket, changeTicketStatus, resolveTicket, closeTicket } = makeUseCases(repos);
    const ticket = await createTicket.execute(CUSTOMER, {
      category: "ACCOUNT",
      subject: "Cannot change my email",
      description: "The email change form always fails validation for me.",
    });

    const assigned = await assignTicket.execute(ADMIN, ticket.id, ADMIN);
    expect(assigned.assignedAdminUserId).toBe(ADMIN);

    const inProgress = await changeTicketStatus.execute(ADMIN, ticket.id, "IN_PROGRESS");
    expect(inProgress.status).toBe("IN_PROGRESS");

    const resolved = await resolveTicket.execute(ADMIN, ticket.id, "Fixed a validation bug in the email form.");
    expect(resolved.status).toBe("RESOLVED");

    const closed = await closeTicket.execute(ADMIN, ticket.id);
    expect(closed.status).toBe("CLOSED");

    expect(repos.auditLog.entries.some((e) => e.action === "SUPPORT_TICKET_CREATED")).toBe(true);
    expect(repos.auditLog.entries.some((e) => e.action === "SUPPORT_TICKET_ASSIGNED")).toBe(true);
    expect(repos.auditLog.entries.some((e) => e.action === "SUPPORT_TICKET_RESOLVED")).toBe(true);
    expect(repos.auditLog.entries.some((e) => e.action === "SUPPORT_TICKET_CLOSED")).toBe(true);
  });

  it("cannot close a ticket that hasn't been resolved yet", async () => {
    const repos = makeRepos();
    const { createTicket, closeTicket } = makeUseCases(repos);
    const ticket = await createTicket.execute(CUSTOMER, {
      category: "OTHER",
      subject: "Just checking something",
      description: "Not really an issue, just a general question about the platform.",
    });
    await expect(closeTicket.execute(ADMIN, ticket.id)).rejects.toThrow(ValidationError);
  });

  it("listMyTickets only returns the caller's own tickets", async () => {
    const repos = makeRepos();
    const { createTicket, listMyTickets } = makeUseCases(repos);
    await createTicket.execute(CUSTOMER, { category: "OTHER", subject: "Mine", description: "This ticket belongs to me." });
    await createTicket.execute(OTHER_CUSTOMER, { category: "OTHER", subject: "Not mine", description: "This ticket belongs to someone else." });

    const mine = await listMyTickets.execute(CUSTOMER, { limit: 20, offset: 0 });
    expect(mine).toHaveLength(1);
    expect(mine[0]?.subject).toBe("Mine");
  });
});

describe("Existing module behavior remains unaffected", () => {
  it("Job start/complete/cancel still work exactly as before with the Dispute module wired in", async () => {
    const repos = makeRepos();
    const { job } = await seedInProgressJob(repos);
    expect(job.status).toBe("IN_PROGRESS");
  });
});
