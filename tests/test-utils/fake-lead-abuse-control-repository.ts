import { randomUUID } from "node:crypto";

import {
  buildLeadAbuseAuditEntry,
  type AdminLeadAbuseBlockDraft,
  type AutomatedLeadAbuseDecisionDraft,
  type LeadAbuseControlRepository,
  type LeadAbuseDecisionOutcome,
  type LeadAbuseDecisionRecord,
  type LeadAbuseFactsReader,
  type LeadAbuseSignalDraft,
} from "@/domain/repositories/lead-abuse-control-repository";
import type { LeadAbuseEventSignalType, LeadAbuseRestrictedAction } from "@/domain/services/lead-abuse-controls";

import type { FakeAdminAuditLogRepository } from "./fake-admin-audit-log-repository";

/**
 * Module 156 test double (tests only). It plays the DATABASE's role for the unit tier: UNIQUE dedupeKey, at most one ACTIVE flag and
 * one ACTIVE block per (subject, action), expiry sweep before a new block, ACTIVE -> LIFTED only, audit entry only for the creator.
 * `failNext` simulates an unavailable store.
 */
export class FakeLeadAbuseControlRepository implements LeadAbuseControlRepository {
  readonly signals: LeadAbuseSignalDraft[] = [];
  readonly decisions: LeadAbuseDecisionRecord[] = [];
  failNext: "all" | "findBlock" | "recordSignal" | null = null;

  constructor(private readonly audit?: FakeAdminAuditLogRepository) {}

  private maybeFail(kind: "findBlock" | "recordSignal"): void {
    if (this.failNext === "all" || this.failNext === kind) {
      this.failNext = null;
      throw new Error("lead abuse store unavailable");
    }
  }

  async recordSignal(draft: LeadAbuseSignalDraft): Promise<boolean> {
    this.maybeFail("recordSignal");
    if (this.signals.some((s) => s.dedupeKey === draft.dedupeKey)) return false;
    this.signals.push({ ...draft });
    return true;
  }

  async findBlockInForce(subjectUserId: string, action: LeadAbuseRestrictedAction, now: Date): Promise<LeadAbuseDecisionRecord | null> {
    this.maybeFail("findBlock");
    return (
      this.decisions.find(
        (d) => d.subjectUserId === subjectUserId && d.action === "TEMPORARY_BLOCK" && d.restrictedAction === action && d.status === "ACTIVE" && d.expiresAt !== null && d.expiresAt > now,
      ) ?? null
    );
  }

  async findDecisionById(id: string): Promise<LeadAbuseDecisionRecord | null> {
    return this.decisions.find((d) => d.id === id) ?? null;
  }

  async listActiveForSubject(subjectUserId: string, now: Date): Promise<LeadAbuseDecisionRecord[]> {
    return this.decisions.filter((d) => d.subjectUserId === subjectUserId && d.status === "ACTIVE" && (d.action === "FLAG_FOR_REVIEW" || (d.expiresAt !== null && d.expiresAt > now)));
  }

  async listOpenFlags(limit: number): Promise<LeadAbuseDecisionRecord[]> {
    return this.decisions
      .filter((d) => d.status === "ACTIVE" && d.action === "FLAG_FOR_REVIEW")
      .sort((a, b) => a.decidedAt.getTime() - b.decidedAt.getTime())
      .slice(0, limit);
  }

  private async create(row: Omit<LeadAbuseDecisionRecord, "id" | "status" | "liftedAt" | "liftedByUserId" | "resolutionNote">, actor: string | null): Promise<LeadAbuseDecisionOutcome> {
    if (row.action === "TEMPORARY_BLOCK") {
      for (const d of this.decisions) {
        if (d.subjectUserId === row.subjectUserId && d.action === "TEMPORARY_BLOCK" && d.restrictedAction === row.restrictedAction && d.status === "ACTIVE" && d.expiresAt !== null && d.expiresAt <= row.decidedAt) {
          d.status = "EXPIRED";
        }
      }
    }
    const existing = this.decisions.find((d) => d.subjectUserId === row.subjectUserId && d.action === row.action && d.restrictedAction === row.restrictedAction && d.status === "ACTIVE");
    if (existing) return { decision: existing, created: false };
    const decision: LeadAbuseDecisionRecord = { ...row, id: randomUUID(), status: "ACTIVE", liftedAt: null, liftedByUserId: null, resolutionNote: null };
    this.decisions.push(decision);
    await this.audit?.record(buildLeadAbuseAuditEntry(row.action === "FLAG_FOR_REVIEW" ? "LEAD_ABUSE_FLAGGED" : "LEAD_ABUSE_BLOCK_APPLIED", actor, decision, null));
    return { decision, created: true };
  }

  applyAutomatedDecision(draft: AutomatedLeadAbuseDecisionDraft): Promise<LeadAbuseDecisionOutcome> {
    return this.create(
      {
        subjectUserId: draft.subjectUserId,
        action: draft.action,
        restrictedAction: draft.restrictedAction,
        origin: "AUTOMATED",
        ruleKey: draft.ruleKey,
        ruleVersion: draft.ruleVersion,
        reasonCode: draft.ruleKey,
        createdByUserId: null,
        decidedAt: draft.decidedAt,
        expiresAt: draft.expiresAt,
        explanation: null,
      },
      null,
    );
  }

  imposeAdminBlock(draft: AdminLeadAbuseBlockDraft): Promise<LeadAbuseDecisionOutcome> {
    return this.create(
      {
        subjectUserId: draft.subjectUserId,
        action: "TEMPORARY_BLOCK",
        restrictedAction: draft.restrictedAction,
        origin: "ADMIN",
        ruleKey: null,
        ruleVersion: null,
        reasonCode: "ADMIN_BLOCK",
        createdByUserId: draft.actorUserId,
        decidedAt: draft.decidedAt,
        expiresAt: draft.expiresAt,
        explanation: draft.explanation,
      },
      draft.actorUserId,
    );
  }

  async lift(id: string, actorUserId: string, note: string, at: Date): Promise<LeadAbuseDecisionRecord | null> {
    const d = this.decisions.find((x) => x.id === id);
    if (!d || d.status !== "ACTIVE") return null;
    d.status = "LIFTED";
    d.liftedAt = at;
    d.liftedByUserId = actorUserId;
    d.resolutionNote = note;
    await this.audit?.record(buildLeadAbuseAuditEntry("LEAD_ABUSE_DECISION_LIFTED", actorUserId, d, "ACTIVE"));
    return d;
  }
}

/** Counts are set by the test; every call is recorded so a test can prove what was (not) read. */
export class FakeLeadAbuseFactsReader implements LeadAbuseFactsReader {
  counts = {
    publications: 0,
    duplicates: 0,
    initiations: 0,
    rejected: 0,
    denied: 0,
    disputesOpened: 0,
    disputesLost: 0,
    revocations: 0,
  };
  readonly calls: string[] = [];
  malformed: Partial<Record<keyof FakeLeadAbuseFactsReader["counts"], unknown>> = {};
  failNext = false;

  private read(kind: keyof FakeLeadAbuseFactsReader["counts"]): Promise<number> {
    this.calls.push(kind);
    if (this.failNext) {
      this.failNext = false;
      return Promise.reject(new Error("facts store unavailable"));
    }
    return Promise.resolve((kind in this.malformed ? this.malformed[kind] : this.counts[kind]) as number);
  }
  countPublicationsByCustomer = () => this.read("publications");
  maxIdenticalRequestGroupByCustomer = () => this.read("duplicates");
  countPurchaseInitiationsByProfessional = () => this.read("initiations");
  countDistinctEventLeads = (_u: string, type: LeadAbuseEventSignalType) => this.read(type === "PURCHASE_REJECTED_EVENT" ? "rejected" : "denied");
  countDisputesOpenedByProfessional = () => this.read("disputesOpened");
  countDisputesLostByProfessional = () => this.read("disputesLost");
  countRevocationsByProfessional = () => this.read("revocations");
}
