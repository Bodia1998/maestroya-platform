import type { JobCompletionConfirmationStatus } from "@/domain/services/job-completion-confirmation-state";
import type { PaymentReleaseStatus } from "@/domain/services/payment-release-decision";

/**
 * Module 66 — Job Completion & Payment Release Protection: repository
 * interface for `JobCompletionConfirmation` — mirrors `JobRepository`'s
 * own "optimistic-concurrency `expectedStatuses` guard on every mutating
 * method" convention exactly, so every write here loses a race the same
 * safe way `JobRepository.startWork`/`complete`/`cancel` already do
 * (throwing `ConflictError` rather than silently overwriting a
 * concurrent change) instead of introducing a second concurrency idiom
 * for this module.
 */

export interface JobCompletionConfirmationRecord {
  id: string;
  jobId: string;
  status: JobCompletionConfirmationStatus;
  professionalCompletedAt: Date;
  confirmationDeadlineAt: Date;
  confirmedAt: Date | null;
  confirmedByUserId: string | null;
  disputeId: string | null;
  manualReviewCaseId: string | null;
  reminderSentAt: Date | null;
  releaseStatus: PaymentReleaseStatus;
  releaseReason: string;
  releaseDecidedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateJobCompletionConfirmationData {
  jobId: string;
  professionalCompletedAt: Date;
  confirmationDeadlineAt: Date;
}

export interface ConfirmCompletionData {
  id: string;
  confirmedByUserId: string;
  confirmedAt: Date;
  expectedStatuses: readonly JobCompletionConfirmationStatus[];
}

export interface DisputeCompletionData {
  id: string;
  disputeId: string;
  expectedStatuses: readonly JobCompletionConfirmationStatus[];
}

export interface TimeOutCompletionData {
  id: string;
  manualReviewCaseId: string;
  expectedStatuses: readonly JobCompletionConfirmationStatus[];
}

export interface UpdateReleaseDecisionData {
  id: string;
  releaseStatus: PaymentReleaseStatus;
  releaseReason: string;
  releaseDecidedAt: Date;
  /** Optimistic guard against the *previous* release status, not against
   *  `status` — release re-evaluation is allowed regardless of which
   *  confirmation `status` the row is in (see
   *  `EvaluatePaymentReleaseUseCase`). */
  expectedReleaseStatuses: readonly PaymentReleaseStatus[];
}

export interface JobCompletionConfirmationRepository {
  findById(id: string): Promise<JobCompletionConfirmationRecord | null>;
  findByJobId(jobId: string): Promise<JobCompletionConfirmationRecord | null>;

  /** Created exactly once per Job, atomically alongside
   *  `JobRepository.complete` — see `CompleteJobUseCase`. Unique on
   *  `jobId`; a second call for the same Job must fail with
   *  `ConflictError` (DB unique constraint), never silently return the
   *  existing row — that would hide a bug in the caller rather than
   *  protect against legitimate concurrency (professional completion is
   *  itself already guarded by `Job.status`'s own `expectedStatuses`). */
  create(data: CreateJobCompletionConfirmationData): Promise<JobCompletionConfirmationRecord>;

  /** WAITING_FOR_CUSTOMER -> CONFIRMED. */
  confirm(data: ConfirmCompletionData): Promise<JobCompletionConfirmationRecord>;

  /** WAITING_FOR_CUSTOMER -> DISPUTED. `disputeId` must reference an
   *  already-created Dispute (see `DisputeJobCompletionUseCase` — the
   *  Dispute is always created first, through the existing
   *  `CreateDisputeUseCase`, before this is called). */
  markDisputed(data: DisputeCompletionData): Promise<JobCompletionConfirmationRecord>;

  /** WAITING_FOR_CUSTOMER -> TIMED_OUT_UNDER_REVIEW. `manualReviewCaseId`
   *  must reference an already-created ManualReviewCase (see
   *  `ProcessJobCompletionConfirmationsUseCase`). */
  markTimedOut(data: TimeOutCompletionData): Promise<JobCompletionConfirmationRecord>;

  /** Records `reminderSentAt` — best-effort, not a strict concurrency
   *  boundary (see `job-completion-confirmation-rules.ts`'s
   *  `isReminderDue`'s own doc comment on why a double-send is tolerated
   *  rather than guarded at the DB level). */
  markReminderSent(id: string, sentAt: Date): Promise<JobCompletionConfirmationRecord>;

  /** Writes the persisted output of `PaymentReleaseDecisionService` — the
   *  ONLY repository method allowed to change `releaseStatus`/
   *  `releaseReason`/`releaseDecidedAt` (see the model's own doc comment
   *  in schema.prisma). Callable regardless of `status`'s current value —
   *  a DISPUTED or TIMED_OUT_UNDER_REVIEW row is still re-evaluated every
   *  time its underlying conditions might have changed (e.g. an admin
   *  closes the dispute). */
  updateReleaseDecision(data: UpdateReleaseDecisionData): Promise<JobCompletionConfirmationRecord>;

  /** Every row still WAITING_FOR_CUSTOMER whose `confirmationDeadlineAt`
   *  has passed as of `now` — the timeout batch's candidate set (see
   *  `ProcessJobCompletionConfirmationsUseCase`). */
  findOverdue(now: Date): Promise<JobCompletionConfirmationRecord[]>;

  /** Every row still WAITING_FOR_CUSTOMER whose reminder point has been
   *  reached but no reminder has been sent yet — the reminder batch's
   *  candidate set. */
  findDueForReminder(now: Date): Promise<JobCompletionConfirmationRecord[]>;
}
