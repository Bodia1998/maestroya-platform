import { Prisma } from "@prisma/client";

import { prisma } from "@/infrastructure/database/prisma/client";
import { ConflictError } from "@/domain/errors/domain-error";
import type { JobCompletionConfirmationStatus } from "@/domain/services/job-completion-confirmation-state";
import type { PaymentReleaseStatus } from "@/domain/services/payment-release-decision";
import type {
  ConfirmCompletionData,
  CreateJobCompletionConfirmationData,
  DisputeCompletionData,
  JobCompletionConfirmationRecord,
  JobCompletionConfirmationRepository,
  TimeOutCompletionData,
  UpdateReleaseDecisionData,
} from "@/domain/repositories/job-completion-confirmation-repository";

const DETAIL_SELECT = {
  id: true,
  jobId: true,
  status: true,
  professionalCompletedAt: true,
  confirmationDeadlineAt: true,
  confirmedAt: true,
  confirmedByUserId: true,
  disputeId: true,
  manualReviewCaseId: true,
  reminderSentAt: true,
  releaseStatus: true,
  releaseReason: true,
  releaseDecidedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

type PrismaRow = {
  id: string;
  jobId: string;
  status: string;
  professionalCompletedAt: Date;
  confirmationDeadlineAt: Date;
  confirmedAt: Date | null;
  confirmedByUserId: string | null;
  disputeId: string | null;
  manualReviewCaseId: string | null;
  reminderSentAt: Date | null;
  releaseStatus: string;
  releaseReason: string;
  releaseDecidedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

function toRecord(row: PrismaRow): JobCompletionConfirmationRecord {
  return {
    id: row.id,
    jobId: row.jobId,
    status: row.status as JobCompletionConfirmationStatus,
    professionalCompletedAt: row.professionalCompletedAt,
    confirmationDeadlineAt: row.confirmationDeadlineAt,
    confirmedAt: row.confirmedAt,
    confirmedByUserId: row.confirmedByUserId,
    disputeId: row.disputeId,
    manualReviewCaseId: row.manualReviewCaseId,
    reminderSentAt: row.reminderSentAt,
    releaseStatus: row.releaseStatus as PaymentReleaseStatus,
    releaseReason: row.releaseReason,
    releaseDecidedAt: row.releaseDecidedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Module 66 — Job Completion & Payment Release Protection: Prisma
 * implementation of `JobCompletionConfirmationRepository`. Every mutating
 * method here uses `updateMany` with an `expected*` guard in its `where`
 * clause — the exact same optimistic-concurrency idiom
 * `PrismaJobRepository`/`PrismaDisputeRepository` already use — so two
 * concurrent requests (a double-submit confirm, confirm racing the
 * timeout worker, two release evaluations at once) can never both apply;
 * the loser gets `ConflictError`, never a silently-overwritten write.
 *
 * The row itself is created by `PrismaJobRepository.complete`, inside the
 * Job's own completion transaction — not by any method here. This
 * repository only ever mutates an already-existing row.
 */
export class PrismaJobCompletionConfirmationRepository implements JobCompletionConfirmationRepository {
  async findById(id: string): Promise<JobCompletionConfirmationRecord | null> {
    const row = await prisma.jobCompletionConfirmation.findUnique({ where: { id }, select: DETAIL_SELECT });
    return row ? toRecord(row) : null;
  }

  async findByJobId(jobId: string): Promise<JobCompletionConfirmationRecord | null> {
    const row = await prisma.jobCompletionConfirmation.findUnique({ where: { jobId }, select: DETAIL_SELECT });
    return row ? toRecord(row) : null;
  }

  /** Not called in production (see this class's own doc comment — the row
   *  is always created by `PrismaJobRepository.complete`'s own
   *  transaction); implemented for interface completeness and for tests
   *  that need to seed a row directly. */
  async create(data: CreateJobCompletionConfirmationData): Promise<JobCompletionConfirmationRecord> {
    try {
      const row = await prisma.jobCompletionConfirmation.create({
        data: {
          jobId: data.jobId,
          status: "WAITING_FOR_CUSTOMER",
          professionalCompletedAt: data.professionalCompletedAt,
          confirmationDeadlineAt: data.confirmationDeadlineAt,
          releaseStatus: "PENDING",
          releaseReason: "Awaiting customer confirmation.",
        },
        select: DETAIL_SELECT,
      });
      return toRecord(row);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ConflictError("This job already has a completion confirmation record.");
      }
      throw error;
    }
  }

  async confirm(data: ConfirmCompletionData): Promise<JobCompletionConfirmationRecord> {
    const result = await prisma.jobCompletionConfirmation.updateMany({
      where: { id: data.id, status: { in: [...data.expectedStatuses] } },
      data: {
        status: "CONFIRMED",
        confirmedAt: data.confirmedAt,
        confirmedByUserId: data.confirmedByUserId,
      },
    });
    if (result.count === 0) {
      throw new ConflictError("This job completion confirmation has already been resolved.");
    }
    const row = await prisma.jobCompletionConfirmation.findUniqueOrThrow({
      where: { id: data.id },
      select: DETAIL_SELECT,
    });
    return toRecord(row);
  }

  async markDisputed(data: DisputeCompletionData): Promise<JobCompletionConfirmationRecord> {
    const result = await prisma.jobCompletionConfirmation.updateMany({
      where: { id: data.id, status: { in: [...data.expectedStatuses] } },
      data: { status: "DISPUTED", disputeId: data.disputeId },
    });
    if (result.count === 0) {
      throw new ConflictError("This job completion confirmation has already been resolved.");
    }
    const row = await prisma.jobCompletionConfirmation.findUniqueOrThrow({
      where: { id: data.id },
      select: DETAIL_SELECT,
    });
    return toRecord(row);
  }

  async markTimedOut(data: TimeOutCompletionData): Promise<JobCompletionConfirmationRecord> {
    const result = await prisma.jobCompletionConfirmation.updateMany({
      where: { id: data.id, status: { in: [...data.expectedStatuses] } },
      data: { status: "TIMED_OUT_UNDER_REVIEW", manualReviewCaseId: data.manualReviewCaseId },
    });
    if (result.count === 0) {
      throw new ConflictError("This job completion confirmation has already been resolved.");
    }
    const row = await prisma.jobCompletionConfirmation.findUniqueOrThrow({
      where: { id: data.id },
      select: DETAIL_SELECT,
    });
    return toRecord(row);
  }

  async markReminderSent(id: string, sentAt: Date): Promise<JobCompletionConfirmationRecord> {
    // Best-effort — no expected-status guard: worst case under a genuine
    // race is a reminder recorded twice as "sent" (still only sent once in
    // practice, since the reminder batch itself only selects rows where
    // `reminderSentAt` is still null — see findDueForReminder), never a
    // financial effect.
    const row = await prisma.jobCompletionConfirmation.update({
      where: { id },
      data: { reminderSentAt: sentAt },
      select: DETAIL_SELECT,
    });
    return toRecord(row);
  }

  /**
   * Guarded against `releaseStatus` (not `status`) — release
   * re-evaluation is allowed from any confirmation `status`, but two
   * concurrent evaluations must still not both "win" and double-publish a
   * transition event (see `EvaluatePaymentReleaseUseCase`'s own
   * idempotency guard, which relies on this update's count to know
   * whether it actually caused the transition).
   */
  async updateReleaseDecision(data: UpdateReleaseDecisionData): Promise<JobCompletionConfirmationRecord> {
    const result = await prisma.jobCompletionConfirmation.updateMany({
      where: { id: data.id, releaseStatus: { in: [...data.expectedReleaseStatuses] } },
      data: {
        releaseStatus: data.releaseStatus,
        releaseReason: data.releaseReason,
        releaseDecidedAt: data.releaseDecidedAt,
      },
    });
    if (result.count === 0) {
      throw new ConflictError("This job's payment release decision changed before this update could be applied.");
    }
    const row = await prisma.jobCompletionConfirmation.findUniqueOrThrow({
      where: { id: data.id },
      select: DETAIL_SELECT,
    });
    return toRecord(row);
  }

  async findOverdue(now: Date): Promise<JobCompletionConfirmationRecord[]> {
    const rows = await prisma.jobCompletionConfirmation.findMany({
      where: { status: "WAITING_FOR_CUSTOMER", confirmationDeadlineAt: { lte: now } },
      select: DETAIL_SELECT,
      orderBy: [{ confirmationDeadlineAt: "asc" }],
    });
    return rows.map(toRecord);
  }

  async findDueForReminder(now: Date): Promise<JobCompletionConfirmationRecord[]> {
    const rows = await prisma.jobCompletionConfirmation.findMany({
      where: {
        status: "WAITING_FOR_CUSTOMER",
        reminderSentAt: null,
        confirmationDeadlineAt: { gt: now },
      },
      select: DETAIL_SELECT,
      orderBy: [{ confirmationDeadlineAt: "asc" }],
    });
    return rows.map(toRecord);
  }
}
