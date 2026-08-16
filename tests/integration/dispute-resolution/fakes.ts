import { ConflictError } from "@/domain/errors/domain-error";
import type {
  CreateDisputeResolutionDecisionData,
  DisputeResolutionDecisionRecord,
  DisputeResolutionDecisionRepository,
  DisputeResolutionDecisionStatusValue,
} from "@/domain/repositories/dispute-resolution-decision-repository";

/**
 * Module 68 — Dispute Resolution & Financial Protection: in-memory test
 * double for `DisputeResolutionDecisionRepository`, same pattern as every
 * other module's `tests/integration/<feature>/fakes.ts` — implements the
 * real interface (including the `disputeId`-unique guard and the
 * optimistic-concurrency `transition` helper) so use cases under test run
 * their genuine orchestration/idempotency/concurrency logic, with only
 * storage swapped out.
 */
let idCounter = 0;
function nextId(prefix: string) {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

export class FakeDisputeResolutionDecisionRepository implements DisputeResolutionDecisionRepository {
  decisions = new Map<string, DisputeResolutionDecisionRecord>();

  async findById(id: string): Promise<DisputeResolutionDecisionRecord | null> {
    return this.decisions.get(id) ?? null;
  }

  async findByDisputeId(disputeId: string): Promise<DisputeResolutionDecisionRecord | null> {
    return [...this.decisions.values()].find((d) => d.disputeId === disputeId) ?? null;
  }

  async create(data: CreateDisputeResolutionDecisionData): Promise<DisputeResolutionDecisionRecord> {
    if (await this.findByDisputeId(data.disputeId)) {
      throw new ConflictError("A resolution decision already exists for this dispute.");
    }
    const now = new Date();
    const record: DisputeResolutionDecisionRecord = {
      id: nextId("fake-resolution-decision"),
      disputeId: data.disputeId,
      jobId: data.jobId,
      paymentId: data.paymentId,
      resolution: data.resolution,
      outcome: data.outcome,
      status: "PENDING_APPLICATION",
      reason: data.reason,
      decidedByUserId: data.decidedByUserId,
      decidedAt: data.decidedAt,
      appliedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    this.decisions.set(record.id, record);
    return record;
  }

  async markApplied(id: string): Promise<DisputeResolutionDecisionRecord> {
    return this.transition(id, "APPLIED");
  }

  async markPartiallyApplied(id: string): Promise<DisputeResolutionDecisionRecord> {
    return this.transition(id, "PARTIALLY_APPLIED");
  }

  async markFailed(id: string): Promise<DisputeResolutionDecisionRecord> {
    return this.transition(id, "FAILED");
  }

  private async transition(id: string, status: DisputeResolutionDecisionStatusValue): Promise<DisputeResolutionDecisionRecord> {
    const existing = this.decisions.get(id);
    if (!existing || existing.status !== "PENDING_APPLICATION") {
      throw new ConflictError("This resolution decision has already been applied.");
    }
    const updated: DisputeResolutionDecisionRecord = { ...existing, status, appliedAt: new Date(), updatedAt: new Date() };
    this.decisions.set(id, updated);
    return updated;
  }
}
