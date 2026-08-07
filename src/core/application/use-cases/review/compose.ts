import { PrismaAdminAuditLogRepository } from "@/infrastructure/database/prisma/repositories/prisma-admin-audit-log-repository";
import { PrismaCustomerProfileRepository } from "@/infrastructure/database/prisma/repositories/prisma-customer-profile-repository";
import { PrismaJobRepository } from "@/infrastructure/database/prisma/repositories/prisma-job-repository";
import { PrismaProfessionalRepository } from "@/infrastructure/database/prisma/repositories/prisma-professional-repository";
import { PrismaReviewRepository } from "@/infrastructure/database/prisma/repositories/prisma-review-repository";
import { createFailureReporter } from "@/infrastructure/observability/failure-reporter-factory";
import { eventBus } from "@/infrastructure/events/compose";
// Side-effect import: registers the Notify*Subscriber handlers against the
// shared eventBus. Mirrors dispute/compose.ts's own identical import of
// notification/compose.ts — see that file's doc comment for why this is
// imported here rather than relying solely on instrumentation.ts.
import "@/application/use-cases/notification/compose";
import { ReviewCreated } from "@/domain/events/review-created";
import { ReviewDeleted } from "@/domain/events/review-deleted";
import { ReviewResponseAdded } from "@/domain/events/review-response-added";
import { ReviewUpdated } from "@/domain/events/review-updated";
import { RecordReviewCreatedAuditLogSubscriber } from "@/application/use-cases/review/record-review-created-audit-log.subscriber";
import { RecordReviewDeletedAuditLogSubscriber } from "@/application/use-cases/review/record-review-deleted-audit-log.subscriber";
import { RecordReviewResponseAddedAuditLogSubscriber } from "@/application/use-cases/review/record-review-response-added-audit-log.subscriber";
import { RecordReviewUpdatedAuditLogSubscriber } from "@/application/use-cases/review/record-review-updated-audit-log.subscriber";
import { CreateReviewUseCase } from "@/application/use-cases/review/create-review.use-case";
import { DeleteReviewUseCase } from "@/application/use-cases/review/delete-review.use-case";
import { GetProfessionalRatingSummaryUseCase } from "@/application/use-cases/review/get-professional-rating-summary.use-case";
import { GetReviewByJobUseCase } from "@/application/use-cases/review/get-review-by-job.use-case";
import { ListProfessionalReviewsUseCase } from "@/application/use-cases/review/list-professional-reviews.use-case";
import { RespondToReviewUseCase } from "@/application/use-cases/review/respond-to-review.use-case";
import { UpdateReviewUseCase } from "@/application/use-cases/review/update-review.use-case";

const reviews = new PrismaReviewRepository();
const jobs = new PrismaJobRepository();
const customerProfiles = new PrismaCustomerProfileRepository();
const professionals = new PrismaProfessionalRepository();
const auditLog = new PrismaAdminAuditLogRepository();
// Module 39 — Sentry + CI/CD Hardening: SentryFailureReporter in
// production, ConsoleFailureReporter otherwise — see
// failure-reporter-factory.ts's own doc comment. No use case or subscriber
// in this module changes.
const failureReporter = createFailureReporter();

/**
 * Module 41 — Reviews & Ratings (Domain Event Subscribers, following the
 * Module 37 pattern): registers this module's four audit-log subscribers
 * against the shared `eventBus`, at module load time — the exact pattern
 * documented in `infrastructure/events/compose.ts`'s own doc comment and
 * mirrored from `dispute/compose.ts`. The sibling notification subscribers
 * are registered the same way from `notification/compose.ts`; neither file
 * imports the other's use cases.
 */
eventBus.subscribe(ReviewCreated, new RecordReviewCreatedAuditLogSubscriber(auditLog));
eventBus.subscribe(ReviewUpdated, new RecordReviewUpdatedAuditLogSubscriber(auditLog));
eventBus.subscribe(ReviewDeleted, new RecordReviewDeletedAuditLogSubscriber(auditLog));
eventBus.subscribe(ReviewResponseAdded, new RecordReviewResponseAddedAuditLogSubscriber(auditLog));

export function makeCreateReviewUseCase() {
  return new CreateReviewUseCase(reviews, jobs, customerProfiles, professionals, eventBus, failureReporter);
}

export function makeGetReviewByJobUseCase() {
  return new GetReviewByJobUseCase(reviews, jobs, customerProfiles, professionals);
}

export function makeListProfessionalReviewsUseCase() {
  return new ListProfessionalReviewsUseCase(reviews);
}

export function makeGetProfessionalRatingSummaryUseCase() {
  return new GetProfessionalRatingSummaryUseCase(reviews);
}

export function makeUpdateReviewUseCase() {
  return new UpdateReviewUseCase(reviews, eventBus, failureReporter);
}

export function makeDeleteReviewUseCase() {
  return new DeleteReviewUseCase(reviews, eventBus, failureReporter);
}

export function makeRespondToReviewUseCase() {
  return new RespondToReviewUseCase(reviews, professionals, eventBus, failureReporter);
}
