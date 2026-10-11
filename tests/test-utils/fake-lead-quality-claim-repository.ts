import type { AdminAuditLogRepository } from "@/domain/repositories/admin-audit-log-repository";
import {
  LeadQualityClaimInsertConflictError,
  buildLeadQualityClaimAuditEntry,
  type LeadQualityClaimAuditAction,
  type LeadQualityClaimDraft,
  type LeadQualityClaimRecord,
  type LeadQualityClaimRepository,
} from "@/domain/repositories/lead-quality-claim-repository";
import type { LeadQualityClaimDecision, LeadQualityClaimStatus } from "@/domain/services/lead-quality-claim";
import {
  LEAD_QUALITY_CLAIM_MAX_OPEN_PER_PROFESSIONAL,
  LEAD_QUALITY_CLAIM_MAX_SUBMITTED_PER_PERIOD,
  isOpenLeadQualityClaimStatus,
  isWithinLeadQualityClaimWindow,
  leadQualityClaimPeriodStart,
  leadQualityClaimRespondBy,
} from "@/domain/services/lead-quality-claim";

/** What the real database knows and the in-memory double must be told. */
export interface FakeLeadQualityClaimEnvironment {
  /** The DATABASE clock: `submittedAt` is stamped from it and the 72-hour window is decided against it. */
  now: () => Date;
  /** `lead_purchases.confirmedAt` of a purchase (the insert trigger reads it). `null`/`undefined` = do not check the window. */
  confirmedAtOf?: (leadPurchaseId: string) => Date | null | undefined;
  /** `professional_profiles.userId` of a profile (separation of duties). */
  ownerUserOf?: (professionalProfileId: string) => string | null | undefined;
}

/**
 * Module 154 test double (tests only): an in-memory `LeadQualityClaimRepository` that enforces the same rules the database does
 * (database-clock `submittedAt` / `respondBy`, the 72-hour window, one claim per purchase, the open / rolling-period limits,
 * forward-only status-conditional moves) and is ATOMIC with the audit trail like the Prisma adapter: each change is applied together
 * with its audit entry, and when the audit write fails the change is rolled back and the error propagates. It does NOT re-check the
 * purchase's owner / CONFIRMED status — those are the use case's job in unit tests and the trigger's job in the real-PostgreSQL suite.
 */
export class FakeLeadQualityClaimRepository implements LeadQualityClaimRepository {
  readonly rows: LeadQualityClaimRecord[] = [];
  private seq = 0;
  /** Set to make the next `create` fail like a database refusal. */
  failNextCreateWith: LeadQualityClaimInsertConflictError | null = null;
  /** Set to simulate a lost race: the status-conditional write finds nothing to update. */
  loseNextWrite = false;

  constructor(
    private readonly audit?: AdminAuditLogRepository,
    private readonly env: FakeLeadQualityClaimEnvironment = { now: () => new Date() },
  ) {}

  async findById(id: string): Promise<LeadQualityClaimRecord | null> {
    const row = this.rows.find((r) => r.id === id);
    return row ? { ...row } : null;
  }

  async findByLeadPurchaseId(leadPurchaseId: string): Promise<LeadQualityClaimRecord | null> {
    const row = this.rows.find((r) => r.leadPurchaseId === leadPurchaseId);
    return row ? { ...row } : null;
  }

  async countOpenByProfessional(professionalProfileId: string): Promise<number> {
    return this.rows.filter((r) => r.professionalProfileId === professionalProfileId && isOpenLeadQualityClaimStatus(r.status)).length;
  }

  async countSubmittedSince(professionalProfileId: string, since: Date): Promise<number> {
    return this.rows.filter((r) => r.professionalProfileId === professionalProfileId && r.submittedAt.getTime() > since.getTime()).length;
  }

  async isClaimOwnedByUser(claimId: string, userId: string): Promise<boolean> {
    const row = this.rows.find((r) => r.id === claimId);
    if (!row) return false;
    return this.env.ownerUserOf?.(row.professionalProfileId) === userId;
  }

  async create(draft: LeadQualityClaimDraft, actorUserId: string): Promise<LeadQualityClaimRecord> {
    if (this.failNextCreateWith) {
      const error = this.failNextCreateWith;
      this.failNextCreateWith = null;
      throw error;
    }
    const submittedAt = this.env.now(); // the database clock, never the caller's
    const confirmedAt = this.env.confirmedAtOf?.(draft.leadPurchaseId);
    if (confirmedAt && !isWithinLeadQualityClaimWindow(confirmedAt, submittedAt)) throw new LeadQualityClaimInsertConflictError("CLAIM_WINDOW_CLOSED");
    if (this.rows.some((r) => r.leadPurchaseId === draft.leadPurchaseId)) throw new LeadQualityClaimInsertConflictError("ALREADY_CLAIMED");
    const mine = this.rows.filter((r) => r.professionalProfileId === draft.professionalProfileId);
    if (mine.filter((r) => isOpenLeadQualityClaimStatus(r.status)).length >= LEAD_QUALITY_CLAIM_MAX_OPEN_PER_PROFESSIONAL) {
      throw new LeadQualityClaimInsertConflictError("OPEN_CLAIM_LIMIT_REACHED");
    }
    const since = leadQualityClaimPeriodStart(submittedAt).getTime();
    if (mine.filter((r) => r.submittedAt.getTime() > since).length >= LEAD_QUALITY_CLAIM_MAX_SUBMITTED_PER_PERIOD) {
      throw new LeadQualityClaimInsertConflictError("PERIOD_CLAIM_LIMIT_REACHED");
    }
    this.seq += 1;
    const row: LeadQualityClaimRecord = {
      id: `00000000-0000-4000-8000-${String(this.seq).padStart(12, "0")}`,
      ...draft,
      status: "SUBMITTED",
      submittedAt,
      respondBy: leadQualityClaimRespondBy(submittedAt),
      reviewStartedAt: null,
      reviewStartedByUserId: null,
      decidedAt: null,
      decidedByUserId: null,
      decisionExplanation: null,
      createdAt: submittedAt,
      updatedAt: submittedAt,
    };
    return this.atomically(() => {
      this.rows.push(row);
      return { ...row };
    }, "LEAD_QUALITY_CLAIM_SUBMITTED", actorUserId, null);
  }

  async markReviewStarted(id: string, actorUserId: string, at: Date): Promise<LeadQualityClaimRecord | null> {
    const row = this.rows.find((r) => r.id === id);
    if (this.consumeLostRace() || !row || row.status !== "SUBMITTED") return null;
    const from = row.status;
    return this.atomically(() => {
      row.status = "UNDER_REVIEW";
      row.reviewStartedAt = at;
      row.reviewStartedByUserId = actorUserId;
      row.updatedAt = at;
      return { ...row };
    }, "LEAD_QUALITY_CLAIM_REVIEW_STARTED", actorUserId, from);
  }

  async decide(
    id: string,
    decision: { to: LeadQualityClaimDecision; actorUserId: string; explanation: string; at: Date },
  ): Promise<LeadQualityClaimRecord | null> {
    const row = this.rows.find((r) => r.id === id);
    if (this.consumeLostRace() || !row || !isOpenLeadQualityClaimStatus(row.status)) return null;
    const from = row.status;
    return this.atomically(() => {
      row.status = decision.to;
      row.decidedAt = decision.at;
      row.decidedByUserId = decision.actorUserId;
      row.decisionExplanation = decision.explanation;
      row.updatedAt = decision.at;
      return { ...row };
    }, decision.to === "APPROVED" ? "LEAD_QUALITY_CLAIM_APPROVED" : "LEAD_QUALITY_CLAIM_REJECTED", decision.actorUserId, from);
  }

  /** Applies `change` and appends its audit entry as ONE unit: a failing audit write restores every row and rethrows. */
  private async atomically(
    change: () => LeadQualityClaimRecord,
    action: LeadQualityClaimAuditAction,
    actorUserId: string,
    fromStatus: LeadQualityClaimStatus | null,
  ): Promise<LeadQualityClaimRecord> {
    const snapshot = this.rows.map((r) => ({ ...r }));
    try {
      const result = change();
      await this.audit?.record(buildLeadQualityClaimAuditEntry(action, actorUserId, result, fromStatus));
      return result;
    } catch (error) {
      this.rows.splice(0, this.rows.length, ...snapshot);
      throw error;
    }
  }

  private consumeLostRace(): boolean {
    const lost = this.loseNextWrite;
    this.loseNextWrite = false;
    return lost;
  }
}
