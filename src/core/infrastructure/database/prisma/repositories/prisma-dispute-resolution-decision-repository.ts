import { Prisma } from "@prisma/client";

import { prisma } from "@/infrastructure/database/prisma/client";
import { ConflictError } from "@/domain/errors/domain-error";
import type { DisputeResolutionValue } from "@/domain/repositories/dispute-repository";
import type {
  CreateDisputeResolutionDecisionData,
  DisputeResolutionDecisionRecord,
  DisputeResolutionDecisionRepository,
  DisputeResolutionDecisionStatusValue,
} from "@/domain/repositories/dispute-resolution-decision-repository";
import type { DisputeFinancialOutcomeValue } from "@/domain/services/dispute-resolution-financial-outcome";

const SELECT = {
  id: true,
  disputeId: true,
  jobId: true,
  paymentId: true,
  resolution: true,
  outcome: true,
  status: true,
  reason: true,
  decidedByUserId: true,
  decidedAt: true,
  appliedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

type Row = {
  id: string;
  disputeId: string;
  jobId: string;
  paymentId: string | null;
  resolution: string;
  outcome: string;
  status: string;
  reason: string;
  decidedByUserId: string;
  decidedAt: Date;
  appliedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

function toRecord(row: Row): DisputeResolutionDecisionRecord {
  return {
    id: row.id,
    disputeId: row.disputeId,
    jobId: row.jobId,
    paymentId: row.paymentId,
    resolution: row.resolution as DisputeResolutionValue,
    outcome: row.outcome as DisputeFinancialOutcomeValue,
    status: row.status as DisputeResolutionDecisionStatusValue,
    reason: row.reason,
    decidedByUserId: row.decidedByUserId,
    decidedAt: row.decidedAt,
    appliedAt: row.appliedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Module 68 — Dispute Resolution & Financial Protection: Prisma
 * implementation of `DisputeResolutionDecisionRepository`. Same shape as
 * `PrismaDisputeRepository` — narrow SELECTs, plain-object mapping, unique-
 * constraint violations translated into `ConflictError` rather than a raw
 * Prisma error, `updateMany`-with-expected-status for every status
 * transition (optimistic concurrency).
 */
export class PrismaDisputeResolutionDecisionRepository implements DisputeResolutionDecisionRepository {
  async findById(id: string): Promise<DisputeResolutionDecisionRecord | null> {
    const row = await prisma.disputeResolutionDecision.findUnique({ where: { id }, select: SELECT });
    return row ? toRecord(row) : null;
  }

  async findByDisputeId(disputeId: string): Promise<DisputeResolutionDecisionRecord | null> {
    const row = await prisma.disputeResolutionDecision.findUnique({ where: { disputeId }, select: SELECT });
    return row ? toRecord(row) : null;
  }

  /**
   * Creates the decision. `disputeId` is unique — a concurrent second
   * attempt for the same dispute (two admins racing a crash-recovery retry,
   * see `ResolveDisputeWithFinancialOutcomeUseCase`'s own doc comment)
   * surfaces as Prisma P2002 and is translated into `ConflictError` here,
   * same convention as `PrismaDisputeRepository.create`.
   */
  async create(data: CreateDisputeResolutionDecisionData): Promise<DisputeResolutionDecisionRecord> {
    try {
      const row = await prisma.disputeResolutionDecision.create({
        data: {
          disputeId: data.disputeId,
          jobId: data.jobId,
          paymentId: data.paymentId,
          resolution: data.resolution,
          outcome: data.outcome,
          status: "PENDING_APPLICATION",
          reason: data.reason,
          decidedByUserId: data.decidedByUserId,
          decidedAt: data.decidedAt,
        },
        select: SELECT,
      });
      return toRecord(row);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ConflictError("A resolution decision already exists for this dispute.");
      }
      throw error;
    }
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
    // Only ever fires once per decision in practice (each is applied
    // exactly once, right after creation) — guarded with the same
    // updateMany-on-expected-status convention as every other status
    // mutation in this codebase anyway, rather than an unconditional
    // update, so a stray duplicate call can never silently re-stamp
    // `appliedAt`.
    const result = await prisma.disputeResolutionDecision.updateMany({
      where: { id, status: "PENDING_APPLICATION" },
      data: { status, appliedAt: new Date() },
    });
    if (result.count === 0) {
      throw new ConflictError("This resolution decision has already been applied.");
    }
    const row = await prisma.disputeResolutionDecision.findUniqueOrThrow({ where: { id }, select: SELECT });
    return toRecord(row);
  }
}
