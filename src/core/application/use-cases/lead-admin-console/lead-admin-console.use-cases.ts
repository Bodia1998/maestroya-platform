import { assertLeadAdminConsoleActor } from "@/application/use-cases/lead-admin-console/assert-lead-admin-console-actor";
import type { AdminRepository } from "@/domain/repositories/admin-repository";
import type {
  AdminAbuseDecisionRow,
  AdminAbuseSignalRow,
  AdminAbuseSubjectRecord,
  AdminClaimQueueRow,
  AdminDisputeQueueRow,
  AdminLeadDetailRecord,
  AdminLeadListRow,
  LeadAdminConsoleReader,
} from "@/domain/repositories/lead-admin-console-reader";
import { LEAD_STATUSES } from "@/domain/services/lead";
import {
  LeadAdminConsoleRejectedError,
  deriveLeadAdminIndicators,
  isLeadAdminRecordOnlySignal,
  normalizeLeadAdminDate,
  normalizeLeadAdminPage,
  normalizeLeadAdminSearchText,
  normalizeLeadAdminUuid,
  sortLeadAdminTimeline,
  type LeadAdminIndicator,
  type LeadAdminTimelineEvent,
} from "@/domain/services/lead-admin-console";
import { isBlockInForce } from "@/domain/services/lead-abuse-controls";
import { LEAD_FEE_DISPUTE_STATUSES } from "@/domain/services/lead-fee-dispute";
import { LEAD_PURCHASE_STATUSES } from "@/domain/services/lead-purchase";
import { LEAD_QUALITY_CLAIM_STATUSES } from "@/domain/services/lead-quality-claim";

/**
 * Module 157 — the READ use cases of the Lead Admin Operations Console.
 *
 * Every one of them: (1) validates its input as pure data, (2) re-reads the administrator (see `assertLeadAdminConsoleActor`),
 * (3) calls a read-only port. None of them has a write port, so a read cannot change domain state (a unit test pins that by
 * giving the reader fake no mutating method and by asserting the audit fake is never touched).
 */

type Admins = Pick<AdminRepository, "getUserById">;

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) throw new LeadAdminConsoleRejectedError("INVALID_INPUT");
  return value as T;
}

export interface ListAdminLeadsInput {
  leadId?: unknown;
  status?: unknown;
  purchaseStatus?: unknown;
  categoryId?: unknown;
  region?: unknown;
  city?: unknown;
  createdFrom?: unknown;
  createdTo?: unknown;
  limit?: unknown;
  offset?: unknown;
}

export class ListAdminLeadsUseCase {
  constructor(
    private readonly admins: Admins,
    private readonly reader: Pick<LeadAdminConsoleReader, "listLeads">,
  ) {}

  async execute(actorUserId: string, input: ListAdminLeadsInput = {}): Promise<AdminLeadListRow[]> {
    const page = normalizeLeadAdminPage(input);
    const status = oneOf(input.status, LEAD_STATUSES);
    const purchaseStatus = oneOf(input.purchaseStatus, LEAD_PURCHASE_STATUSES);
    const leadId = input.leadId === undefined || input.leadId === null || input.leadId === "" ? undefined : normalizeLeadAdminUuid(input.leadId);
    const categoryId = input.categoryId === undefined || input.categoryId === null || input.categoryId === "" ? undefined : normalizeLeadAdminUuid(input.categoryId);
    const region = normalizeLeadAdminSearchText(input.region);
    const city = normalizeLeadAdminSearchText(input.city);
    const createdFrom = normalizeLeadAdminDate(input.createdFrom);
    const createdTo = normalizeLeadAdminDate(input.createdTo);
    if (createdFrom && createdTo && createdFrom.getTime() > createdTo.getTime()) throw new LeadAdminConsoleRejectedError("INVALID_INPUT");

    await assertLeadAdminConsoleActor(this.admins, actorUserId);
    return this.reader.listLeads({ leadId, status, purchaseStatus, categoryId, region, city, createdFrom, createdTo, ...page });
  }
}

export interface AdminAbuseSignalView extends AdminAbuseSignalRow {
  /** True for PURCHASE_REJECTED_PROBING / PURCHASE_REJECTED_EVENT: evidence only, never a flag or block on its own (M156). */
  recordOnly: boolean;
}

export interface AdminLeadDetailView extends Omit<AdminLeadDetailRecord, "signals"> {
  signals: AdminAbuseSignalView[];
  /** Oldest first. Each event says whether it is a recorded fact, an audit entry or a heuristic signal. */
  timeline: LeadAdminTimelineEvent[];
  /** Computed at read time from the facts above; never persisted. */
  indicators: LeadAdminIndicator[];
  generatedAt: Date;
}

export function toAbuseSignalView(row: AdminAbuseSignalRow): AdminAbuseSignalView {
  return { ...row, recordOnly: isLeadAdminRecordOnlySignal(row.signalType) };
}

/** Builds the investigation timeline from persisted facts. Pure. */
export function buildLeadAdminTimeline(detail: AdminLeadDetailRecord): LeadAdminTimelineEvent[] {
  const events: LeadAdminTimelineEvent[] = [];
  const { lead } = detail;
  events.push({ at: lead.createdAt, basis: "RECORDED_FACT", subject: "LEAD", code: "LEAD_CREATED", refId: lead.id, toStatus: "DRAFT" });
  if (lead.publishedAt) events.push({ at: lead.publishedAt, basis: "RECORDED_FACT", subject: "LEAD", code: "LEAD_PUBLISHED", refId: lead.id, toStatus: "PUBLISHED" });

  for (const p of detail.purchases) {
    events.push({ at: p.createdAt, basis: "RECORDED_FACT", subject: "PURCHASE", code: "PURCHASE_CREATED", refId: p.id, toStatus: "PENDING_PAYMENT" });
    const stamps: Array<[Date | null, string, string]> = [
      [p.confirmedAt, "PURCHASE_CONFIRMED", "CONFIRMED"],
      [p.failedAt, "PURCHASE_FAILED", "FAILED"],
      [p.cancelledAt, "PURCHASE_CANCELLED", "CANCELLED"],
      [p.refundedAt, "PURCHASE_REFUNDED", "REFUNDED"],
      [p.revokedAt, "PURCHASE_REVOKED", "REVOKED"],
    ];
    for (const [at, code, toStatus] of stamps) if (at) events.push({ at, basis: "RECORDED_FACT", subject: "PURCHASE", code, refId: p.id, toStatus });
  }
  for (const c of detail.claims) {
    events.push({ at: c.submittedAt, basis: "RECORDED_FACT", subject: "CLAIM", code: "CLAIM_SUBMITTED", refId: c.id, toStatus: "SUBMITTED" });
    if (c.reviewStartedAt) {
      events.push({ at: c.reviewStartedAt, basis: "RECORDED_FACT", subject: "CLAIM", code: "CLAIM_REVIEW_STARTED", refId: c.id, actorUserId: c.reviewStartedByUserId, fromStatus: "SUBMITTED", toStatus: "UNDER_REVIEW" });
    }
    if (c.decidedAt) {
      events.push({ at: c.decidedAt, basis: "RECORDED_FACT", subject: "CLAIM", code: "CLAIM_DECIDED", refId: c.id, actorUserId: c.decidedByUserId, toStatus: c.status });
    }
  }
  for (const d of detail.disputes) {
    events.push({ at: d.openedAt, basis: "RECORDED_FACT", subject: "DISPUTE", code: "DISPUTE_OPENED", refId: d.id });
    if (d.evidenceRequestedAt) events.push({ at: d.evidenceRequestedAt, basis: "RECORDED_FACT", subject: "DISPUTE", code: "DISPUTE_EVIDENCE_REQUESTED", refId: d.id });
    if (d.evidenceSubmittedAt) events.push({ at: d.evidenceSubmittedAt, basis: "RECORDED_FACT", subject: "DISPUTE", code: "DISPUTE_EVIDENCE_SUBMITTED", refId: d.id });
    if (d.closedAt) events.push({ at: d.closedAt, basis: "RECORDED_FACT", subject: "DISPUTE", code: "DISPUTE_CLOSED", refId: d.id, toStatus: d.status });
  }
  for (const r of detail.revocations) {
    events.push({ at: r.createdAt, basis: "RECORDED_FACT", subject: "REVOCATION", code: "REVOCATION_RECORDED", refId: r.id, actorUserId: r.actorUserId, toStatus: r.source });
  }
  for (const s of detail.signals) {
    events.push({ at: s.occurredAt, basis: s.reliability === "RELIABLE" ? "RECORDED_FACT" : "HEURISTIC_SIGNAL", subject: "ABUSE_SIGNAL", code: s.signalType, refId: s.id });
  }
  for (const a of detail.audit) {
    const from = a.metadata.fromStatus;
    const to = a.metadata.toStatus;
    events.push({
      at: a.createdAt,
      basis: "AUDIT_ENTRY",
      subject: "AUDIT",
      code: typeof a.metadata.adminAction === "string" ? a.metadata.adminAction : a.action,
      refId: a.id,
      actorUserId: a.actorUserId,
      fromStatus: typeof from === "string" ? from : null,
      toStatus: typeof to === "string" ? to : null,
    });
  }
  return sortLeadAdminTimeline(events);
}

export class GetAdminLeadDetailUseCase {
  constructor(
    private readonly admins: Admins,
    private readonly reader: Pick<LeadAdminConsoleReader, "getLeadDetail">,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async execute(actorUserId: string, leadId: unknown): Promise<AdminLeadDetailView> {
    const id = normalizeLeadAdminUuid(leadId);
    await assertLeadAdminConsoleActor(this.admins, actorUserId);
    const detail = await this.reader.getLeadDetail(id);
    if (!detail) throw new LeadAdminConsoleRejectedError("LEAD_NOT_FOUND");
    const now = this.now();
    return {
      ...detail,
      signals: detail.signals.map(toAbuseSignalView),
      timeline: buildLeadAdminTimeline(detail),
      indicators: deriveLeadAdminIndicators({
        now,
        maxBuyers: detail.lead.maxBuyers,
        purchases: detail.purchases,
        claims: detail.claims,
        disputes: detail.disputes,
      }),
      generatedAt: now,
    };
  }
}

export class ListAdminLeadClaimsUseCase {
  constructor(
    private readonly admins: Admins,
    private readonly reader: Pick<LeadAdminConsoleReader, "listClaims">,
  ) {}

  async execute(actorUserId: string, input: { status?: unknown; limit?: unknown; offset?: unknown } = {}): Promise<AdminClaimQueueRow[]> {
    const page = normalizeLeadAdminPage(input);
    const status = oneOf(input.status, LEAD_QUALITY_CLAIM_STATUSES);
    await assertLeadAdminConsoleActor(this.admins, actorUserId);
    return this.reader.listClaims({ status, ...page });
  }
}

export class ListAdminLeadDisputesUseCase {
  constructor(
    private readonly admins: Admins,
    private readonly reader: Pick<LeadAdminConsoleReader, "listDisputes">,
  ) {}

  async execute(actorUserId: string, input: { status?: unknown; limit?: unknown; offset?: unknown } = {}): Promise<AdminDisputeQueueRow[]> {
    const page = normalizeLeadAdminPage(input);
    const status = oneOf(input.status, LEAD_FEE_DISPUTE_STATUSES);
    await assertLeadAdminConsoleActor(this.admins, actorUserId);
    return this.reader.listDisputes({ status, ...page });
  }
}

export interface AdminAbuseDecisionView extends AdminAbuseDecisionRow {
  /** DERIVED at read time: an ACTIVE block whose expiry has not passed. A flag never restricts. */
  restrictingNow: boolean;
}

export interface AdminAbuseSubjectView {
  subjectUserId: string;
  signals: AdminAbuseSignalView[];
  decisions: AdminAbuseDecisionView[];
  generatedAt: Date;
}

export class GetAdminAbuseSubjectUseCase {
  constructor(
    private readonly admins: Admins,
    private readonly reader: Pick<LeadAdminConsoleReader, "getAbuseSubject">,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async execute(actorUserId: string, subjectUserId: unknown): Promise<AdminAbuseSubjectView> {
    const id = normalizeLeadAdminUuid(subjectUserId);
    await assertLeadAdminConsoleActor(this.admins, actorUserId);
    const record: AdminAbuseSubjectRecord | null = await this.reader.getAbuseSubject(id);
    if (!record) throw new LeadAdminConsoleRejectedError("SUBJECT_NOT_FOUND");
    const now = this.now();
    return {
      subjectUserId: record.subjectUserId,
      signals: record.signals.map(toAbuseSignalView),
      decisions: record.decisions.map((d) => ({ ...d, restrictingNow: isBlockInForce(d, now) })),
      generatedAt: now,
    };
  }
}
