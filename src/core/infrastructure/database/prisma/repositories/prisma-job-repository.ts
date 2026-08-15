import { Prisma } from "@prisma/client";

import { prisma } from "@/infrastructure/database/prisma/client";
import { ConflictError } from "@/domain/errors/domain-error";
import { NON_TERMINAL_STATUSES as APPOINTMENT_NON_TERMINAL_STATUSES } from "@/domain/services/appointment-state";
import { computeConfirmationDeadline } from "@/domain/services/job-completion-confirmation-rules";
import type {
  CancelJobData,
  CompleteJobData,
  JobCancellationReasonValue,
  JobRecord,
  JobRepository,
  JobStatusValue,
  JobSummary,
  ListJobsOptions,
  StartJobData,
} from "@/domain/repositories/job-repository";

const DETAIL_SELECT = {
  id: true,
  serviceRequestId: true,
  quoteId: true,
  customerId: true,
  professionalProfileId: true,
  companyProfileId: true,
  status: true,
  startedAt: true,
  startedByUserId: true,
  completedAt: true,
  completedByUserId: true,
  cancelledAt: true,
  cancelledByUserId: true,
  cancellationReason: true,
  cancellationNote: true,
  createdAt: true,
  updatedAt: true,
} as const;

type PrismaJobDetailRow = {
  id: string;
  serviceRequestId: string;
  quoteId: string;
  customerId: string;
  professionalProfileId: string | null;
  companyProfileId: string | null;
  status: string;
  startedAt: Date | null;
  startedByUserId: string | null;
  completedAt: Date | null;
  completedByUserId: string | null;
  cancelledAt: Date | null;
  cancelledByUserId: string | null;
  cancellationReason: string | null;
  cancellationNote: string | null;
  createdAt: Date;
  updatedAt: Date;
};

function toDetailRecord(row: PrismaJobDetailRow): JobRecord {
  return {
    id: row.id,
    serviceRequestId: row.serviceRequestId,
    quoteId: row.quoteId,
    customerId: row.customerId,
    professionalProfileId: row.professionalProfileId,
    companyProfileId: row.companyProfileId,
    status: row.status as JobStatusValue,
    startedAt: row.startedAt,
    startedByUserId: row.startedByUserId,
    completedAt: row.completedAt,
    completedByUserId: row.completedByUserId,
    cancelledAt: row.cancelledAt,
    cancelledByUserId: row.cancelledByUserId,
    cancellationReason: row.cancellationReason as JobCancellationReasonValue | null,
    cancellationNote: row.cancellationNote,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

const NON_TERMINAL: JobStatusValue[] = ["CREATED", "IN_PROGRESS"];

const CUSTOMER_VIEW_JOB_SELECT = {
  id: true,
  serviceRequestId: true,
  status: true,
  startedAt: true,
  completedAt: true,
  createdAt: true,
  serviceRequest: { select: { title: true } },
  professionalProfile: { select: { businessName: true, user: { select: { name: true } } } },
  companyProfile: { select: { legalName: true, tradeName: true } },
} as const;

type CustomerViewJobRow = {
  id: string;
  serviceRequestId: string;
  status: string;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  serviceRequest: { title: string };
  professionalProfile: { businessName: string | null; user: { name: string | null } } | null;
  companyProfile: { legalName: string; tradeName: string | null } | null;
};

function toCustomerViewSummary(row: CustomerViewJobRow): JobSummary {
  const counterpartyName =
    row.companyProfile?.tradeName ??
    row.companyProfile?.legalName ??
    row.professionalProfile?.businessName ??
    row.professionalProfile?.user.name ??
    null;

  return {
    id: row.id,
    serviceRequestId: row.serviceRequestId,
    serviceRequestTitle: row.serviceRequest.title,
    status: row.status as JobStatusValue,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    counterpartyName,
    createdAt: row.createdAt,
  };
}

const PROFESSIONAL_VIEW_JOB_SELECT = {
  id: true,
  serviceRequestId: true,
  status: true,
  startedAt: true,
  completedAt: true,
  createdAt: true,
  serviceRequest: { select: { title: true, customer: { select: { user: { select: { name: true } } } } } },
} as const;

type ProfessionalViewJobRow = {
  id: string;
  serviceRequestId: string;
  status: string;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  serviceRequest: { title: string; customer: { user: { name: string | null } } };
};

function toProfessionalViewSummary(row: ProfessionalViewJobRow): JobSummary {
  return {
    id: row.id,
    serviceRequestId: row.serviceRequestId,
    serviceRequestTitle: row.serviceRequest.title,
    status: row.status as JobStatusValue,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    counterpartyName: row.serviceRequest.customer.user.name ?? null,
    createdAt: row.createdAt,
  };
}

function statusFilter(filter: ListJobsOptions["filter"]) {
  switch (filter) {
    case "active":
      return { status: { in: NON_TERMINAL } };
    case "completed":
      return { status: "COMPLETED" as const };
    case "cancelled":
      return { status: "CANCELLED" as const };
    default:
      return {};
  }
}

/**
 * Order / Job Lifecycle module (Module 11): Prisma implementation of the
 * Job lifecycle after creation. Kept entirely separate from
 * PrismaQuoteAcceptanceRepository (see job-repository.ts's doc comment) —
 * this class never creates a Job, only starts/completes/cancels/reads ones
 * that already exist.
 */
export class PrismaJobRepository implements JobRepository {
  async findById(id: string): Promise<JobRecord | null> {
    const row = await prisma.job.findUnique({ where: { id }, select: DETAIL_SELECT });
    return row ? toDetailRecord(row) : null;
  }

  async listForCustomer(customerId: string, options: ListJobsOptions): Promise<JobSummary[]> {
    const rows = await prisma.job.findMany({
      where: { customerId, ...statusFilter(options.filter) },
      select: CUSTOMER_VIEW_JOB_SELECT,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: options.limit,
      skip: options.offset,
    });
    return rows.map(toCustomerViewSummary);
  }

  async listForProfessional(professionalProfileId: string, options: ListJobsOptions): Promise<JobSummary[]> {
    const rows = await prisma.job.findMany({
      where: { professionalProfileId, ...statusFilter(options.filter) },
      select: PROFESSIONAL_VIEW_JOB_SELECT,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: options.limit,
      skip: options.offset,
    });
    return rows.map(toProfessionalViewSummary);
  }

  async startWork(data: StartJobData): Promise<JobRecord> {
    const updated = await prisma.job.updateMany({
      where: { id: data.jobId, status: { in: [...data.expectedStatuses] } },
      data: {
        status: "IN_PROGRESS",
        startedAt: new Date(),
        startedByUserId: data.startedByUserId,
      },
    });
    if (updated.count === 0) {
      throw new ConflictError("This job can no longer be started.");
    }
    const row = await prisma.job.findUniqueOrThrow({ where: { id: data.jobId }, select: DETAIL_SELECT });
    return toDetailRecord(row);
  }

  /**
   * IN_PROGRESS -> COMPLETED. Everything happens inside one Prisma
   * interactive transaction, mirroring PrismaAppointmentRepository.confirm's
   * own "re-read, re-verify, then write" shape: re-reads the Job's current
   * status (closing the optimistic-concurrency race window the same way
   * every other mutating method here does), then re-queries every
   * Appointment belonging to this Job for a non-terminal status
   * (PENDING_SCHEDULE/PROPOSED/CONFIRMED — see appointment-state.ts)
   * immediately before writing — never trusting a previously-fetched
   * Appointment list, since a new proposal or reschedule could have
   * happened concurrently between the caller's own pre-check and this call.
   * If any non-terminal Appointment is found, this throws and completes
   * nothing — a Job is never completed while a visit is still outstanding,
   * and Appointments are never silently auto-completed as a side effect.
   *
   * Module 66 — Job Completion & Payment Release Protection: this same
   * transaction ALSO creates the Job's `JobCompletionConfirmation` row
   * (WAITING_FOR_CUSTOMER, `confirmationDeadlineAt` computed off the exact
   * same `completedAt` this write uses) — see JobRepository.complete's own
   * doc comment for why this must never be a separate, later call. A
   * `jobId` unique-constraint violation here (a second completion attempt
   * somehow reaching this far) surfaces as the same ConflictError every
   * other race in this method already throws, rather than a raw Prisma
   * error — this should be unreachable in practice since `status` is
   * already re-checked above, but the constraint is the final guarantee.
   */
  async complete(data: CompleteJobData): Promise<JobRecord> {
    return prisma.$transaction(async (tx) => {
      const job = await tx.job.findUnique({ where: { id: data.jobId }, select: { id: true, status: true } });
      if (!job || !data.expectedStatuses.includes(job.status as JobStatusValue)) {
        throw new ConflictError("This job can no longer be completed.");
      }

      const outstandingAppointment = await tx.appointment.findFirst({
        where: { jobId: data.jobId, status: { in: [...APPOINTMENT_NON_TERMINAL_STATUSES] } },
        select: { id: true },
      });
      if (outstandingAppointment) {
        throw new ConflictError(
          "This job still has an unresolved appointment — resolve or cancel every appointment before completing the job.",
        );
      }

      const completedAt = new Date();

      const updated = await tx.job.updateMany({
        where: { id: data.jobId, status: { in: [...data.expectedStatuses] } },
        data: {
          status: "COMPLETED",
          completedAt,
          completedByUserId: data.completedByUserId,
        },
      });
      if (updated.count === 0) {
        // Lost a race with a concurrent state change (cancel, another
        // completion attempt, etc.) between the read above and this write.
        throw new ConflictError("This job can no longer be completed.");
      }

      try {
        await tx.jobCompletionConfirmation.create({
          data: {
            jobId: data.jobId,
            status: "WAITING_FOR_CUSTOMER",
            professionalCompletedAt: completedAt,
            confirmationDeadlineAt: computeConfirmationDeadline(completedAt),
            releaseStatus: "PENDING",
            releaseReason: "Awaiting customer confirmation.",
          },
        });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          throw new ConflictError("This job already has a completion confirmation record.");
        }
        throw error;
      }

      const row = await tx.job.findUniqueOrThrow({ where: { id: data.jobId }, select: DETAIL_SELECT });
      return toDetailRecord(row);
    });
  }

  async cancel(data: CancelJobData): Promise<JobRecord> {
    const updated = await prisma.job.updateMany({
      where: { id: data.jobId, status: { in: [...data.expectedStatuses] } },
      data: {
        status: "CANCELLED",
        cancelledAt: new Date(),
        cancelledByUserId: data.cancelledByUserId,
        cancellationReason: data.reason,
        cancellationNote: data.note,
      },
    });
    if (updated.count === 0) {
      throw new ConflictError("This job can no longer be cancelled.");
    }
    const row = await prisma.job.findUniqueOrThrow({ where: { id: data.jobId }, select: DETAIL_SELECT });
    return toDetailRecord(row);
  }
}
