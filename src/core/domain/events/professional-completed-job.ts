import { DomainEvent } from "@/domain/events/domain-event";

/**
 * Module 66 — Job Completion & Payment Release Protection.
 *
 * Raised by `CompleteJobUseCase` the moment a professional marks a Job
 * COMPLETED — carries the same fact `JobNotifier`/`NotificationCreator`
 * already act on, but as a proper domain event so Module 67 (fraud/risk
 * detection on premature completion) can subscribe without this module
 * needing to know Module 67 exists. `startedAt` is included specifically
 * so a future subscriber can compute "how long did this job actually
 * take" without a second Job lookup — the signal this module's brief asks
 * Module 66 to expose, not to act on itself.
 */
export class ProfessionalCompletedJob extends DomainEvent {
  static readonly eventName = "job.professional-completed";

  constructor(
    readonly jobId: string,
    readonly professionalProfileId: string | null,
    readonly companyProfileId: string | null,
    readonly actorUserId: string,
    readonly startedAt: Date | null,
    readonly completedAt: Date,
    readonly confirmationDeadlineAt: Date,
  ) {
    super();
  }
}
