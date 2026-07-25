import { ConflictError } from "@/domain/errors/domain-error";
import type {
  AdminAuditAction,
  AdminAuditLogRecord,
  AdminAuditLogRepository,
  ListAdminAuditLogsOptions,
  RecordAdminAuditLogData,
} from "@/domain/repositories/admin-audit-log-repository";
import type {
  CreateDisputeData,
  DisputeRecord,
  DisputeRepository,
  DisputeStatusValue,
  ListAdminDisputesOptions,
  ListDisputesOptions,
} from "@/domain/repositories/dispute-repository";
import type {
  CreateDisputeMessageData,
  DisputeMessageRecord,
  DisputeMessageRepository,
} from "@/domain/repositories/dispute-message-repository";
import type {
  CreateDisputeEvidenceData,
  DisputeEvidenceRecord,
  DisputeEvidenceRepository,
} from "@/domain/repositories/dispute-evidence-repository";
import type {
  CreateSupportTicketData,
  ListAdminSupportTicketsOptions,
  ListSupportTicketsOptions,
  SupportTicketRecord,
  SupportTicketRepository,
  SupportTicketStatusValue,
} from "@/domain/repositories/support-ticket-repository";

/**
 * Module 21 — Disputes & Support: in-memory test doubles, same pattern as
 * every other module's fakes.ts (see tests/integration/review/fakes.ts's
 * own doc comment) — implement the real interfaces so use cases under test
 * run their genuine orchestration/authorization logic, with only storage
 * swapped out.
 */

let idCounter = 0;
function nextId(prefix: string) {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

export class FakeDisputeRepository implements DisputeRepository {
  disputes = new Map<string, DisputeRecord>();

  async findById(id: string) {
    return this.disputes.get(id) ?? null;
  }

  async listByJobId(jobId: string) {
    return [...this.disputes.values()]
      .filter((d) => d.jobId === jobId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async listRaisedByUser(userId: string, options: ListDisputesOptions) {
    return [...this.disputes.values()]
      .filter((d) => d.raisedByUserId === userId && (!options.status || d.status === options.status))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(options.offset, options.offset + options.limit);
  }

  async listForAdmin(options: ListAdminDisputesOptions) {
    return [...this.disputes.values()]
      .filter((d) => {
        if (options.status && d.status !== options.status) return false;
        if (options.priority && d.priority !== options.priority) return false;
        if (options.reason && d.reason !== options.reason) return false;
        if (options.assignedAdminUserId && d.assignedAdminUserId !== options.assignedAdminUserId) return false;
        if (options.search) {
          const s = options.search.toLowerCase();
          if (!d.caseNumber.toLowerCase().includes(s) && !d.title.toLowerCase().includes(s)) return false;
        }
        return true;
      })
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(options.offset, options.offset + options.limit);
  }

  async create(data: CreateDisputeData): Promise<DisputeRecord> {
    // Mirrors the DB's two unique constraints — caseNumber, and "at most
    // one OPEN dispute per (job, opener)" — same synchronous check-then-set
    // reasoning as FakeReviewRepository.create's own doc comment.
    const caseNumberTaken = [...this.disputes.values()].some((d) => d.caseNumber === data.caseNumber);
    if (caseNumberTaken) {
      throw new ConflictError("Case number collided.");
    }
    const alreadyOpen = [...this.disputes.values()].some(
      (d) => d.jobId === data.jobId && d.raisedByUserId === data.raisedByUserId && d.status === "OPEN",
    );
    if (alreadyOpen) {
      throw new ConflictError("You already have an open dispute for this job.");
    }

    const now = new Date();
    const record: DisputeRecord = {
      id: nextId("fake-dispute"),
      caseNumber: data.caseNumber,
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
      createdAt: now,
      updatedAt: now,
    };
    this.disputes.set(record.id, record);
    return record;
  }

  async updateStatus(
    id: string,
    expectedStatus: DisputeStatusValue,
    data: Partial<DisputeRecord> & { status: DisputeStatusValue },
  ): Promise<DisputeRecord> {
    const existing = this.disputes.get(id);
    if (!existing || existing.status !== expectedStatus) {
      throw new ConflictError("This dispute's status changed before this update could be applied.");
    }
    const updated: DisputeRecord = {
      ...existing,
      status: data.status,
      resolution: data.resolution !== undefined ? data.resolution : existing.resolution,
      resolutionNote: data.resolutionNote !== undefined ? data.resolutionNote : existing.resolutionNote,
      resolvedAt: data.resolvedAt !== undefined ? data.resolvedAt : existing.resolvedAt,
      resolvedByUserId: data.resolvedByUserId !== undefined ? data.resolvedByUserId : existing.resolvedByUserId,
      closedAt: data.closedAt !== undefined ? data.closedAt : existing.closedAt,
      closedByUserId: data.closedByUserId !== undefined ? data.closedByUserId : existing.closedByUserId,
      updatedAt: new Date(),
    };
    this.disputes.set(id, updated);
    return updated;
  }

  async assign(id: string, assignedAdminUserId: string | null) {
    const existing = this.disputes.get(id);
    if (!existing) throw new Error(`No fake dispute ${id}`);
    const updated = { ...existing, assignedAdminUserId, updatedAt: new Date() };
    this.disputes.set(id, updated);
    return updated;
  }

  async setPriority(id: string, priority: DisputeRecord["priority"]) {
    const existing = this.disputes.get(id);
    if (!existing) throw new Error(`No fake dispute ${id}`);
    const updated = { ...existing, priority, updatedAt: new Date() };
    this.disputes.set(id, updated);
    return updated;
  }
}

export class FakeDisputeMessageRepository implements DisputeMessageRepository {
  messages: DisputeMessageRecord[] = [];

  async create(data: CreateDisputeMessageData): Promise<DisputeMessageRecord> {
    const record: DisputeMessageRecord = {
      id: nextId("fake-dispute-message"),
      disputeId: data.disputeId,
      authorUserId: data.authorUserId,
      body: data.body,
      isInternalNote: data.isInternalNote,
      createdAt: new Date(),
    };
    this.messages.push(record);
    return record;
  }

  async listPublic(disputeId: string) {
    return this.messages.filter((m) => m.disputeId === disputeId && !m.isInternalNote);
  }

  async listAll(disputeId: string) {
    return this.messages.filter((m) => m.disputeId === disputeId);
  }
}

export class FakeDisputeEvidenceRepository implements DisputeEvidenceRepository {
  evidence: DisputeEvidenceRecord[] = [];

  async listByDisputeId(disputeId: string) {
    return this.evidence.filter((e) => e.disputeId === disputeId);
  }

  async create(data: CreateDisputeEvidenceData): Promise<DisputeEvidenceRecord> {
    const record: DisputeEvidenceRecord = { id: nextId("fake-dispute-evidence"), createdAt: new Date(), ...data };
    this.evidence.push(record);
    return record;
  }
}

export class FakeAdminAuditLogRepository implements AdminAuditLogRepository {
  entries: AdminAuditLogRecord[] = [];

  async record(data: RecordAdminAuditLogData): Promise<AdminAuditLogRecord> {
    const record: AdminAuditLogRecord = {
      id: nextId("fake-audit-log"),
      adminUserId: data.adminUserId,
      action: data.action as AdminAuditAction,
      targetType: data.targetType,
      targetId: data.targetId,
      metadata: data.metadata ?? null,
      createdAt: new Date(),
    };
    this.entries.push(record);
    return record;
  }

  async list(options: ListAdminAuditLogsOptions): Promise<AdminAuditLogRecord[]> {
    return [...this.entries].reverse().slice(options.offset, options.offset + options.limit);
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
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(options.offset, options.offset + options.limit);
  }

  async countAll(): Promise<number> {
    return this.tickets.size;
  }

  async listForAdmin(options: ListAdminSupportTicketsOptions) {
    return [...this.tickets.values()]
      .filter((t) => {
        if (options.status && t.status !== options.status) return false;
        if (options.priority && t.priority !== options.priority) return false;
        if (options.category && t.category !== options.category) return false;
        if (options.assignedAdminUserId && t.assignedAdminUserId !== options.assignedAdminUserId) return false;
        return true;
      })
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(options.offset, options.offset + options.limit);
  }

  async create(data: CreateSupportTicketData): Promise<SupportTicketRecord> {
    const taken = [...this.tickets.values()].some((t) => t.ticketNumber === data.ticketNumber);
    if (taken) throw new ConflictError("Ticket number collided.");
    const now = new Date();
    const record: SupportTicketRecord = {
      id: nextId("fake-ticket"),
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
      createdAt: now,
      updatedAt: now,
    };
    this.tickets.set(record.id, record);
    return record;
  }

  async updateStatus(
    id: string,
    expectedStatus: SupportTicketStatusValue,
    data: Partial<SupportTicketRecord> & { status: SupportTicketStatusValue },
  ): Promise<SupportTicketRecord> {
    const existing = this.tickets.get(id);
    if (!existing || existing.status !== expectedStatus) {
      throw new ConflictError("This ticket's status changed before this update could be applied.");
    }
    const updated: SupportTicketRecord = {
      ...existing,
      status: data.status,
      resolutionNote: data.resolutionNote !== undefined ? data.resolutionNote : existing.resolutionNote,
      resolvedAt: data.resolvedAt !== undefined ? data.resolvedAt : existing.resolvedAt,
      resolvedByUserId: data.resolvedByUserId !== undefined ? data.resolvedByUserId : existing.resolvedByUserId,
      closedAt: data.closedAt !== undefined ? data.closedAt : existing.closedAt,
      closedByUserId: data.closedByUserId !== undefined ? data.closedByUserId : existing.closedByUserId,
      updatedAt: new Date(),
    };
    this.tickets.set(id, updated);
    return updated;
  }

  async assign(id: string, assignedAdminUserId: string | null) {
    const existing = this.tickets.get(id);
    if (!existing) throw new Error(`No fake ticket ${id}`);
    const updated = { ...existing, assignedAdminUserId, updatedAt: new Date() };
    this.tickets.set(id, updated);
    return updated;
  }
}
