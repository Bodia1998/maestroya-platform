import { PrismaCustomerProfileRepository } from "@/infrastructure/database/prisma/repositories/prisma-customer-profile-repository";
import { PrismaJobRepository } from "@/infrastructure/database/prisma/repositories/prisma-job-repository";
import { PrismaProfessionalRepository } from "@/infrastructure/database/prisma/repositories/prisma-professional-repository";
import { PrismaReviewRepository } from "@/infrastructure/database/prisma/repositories/prisma-review-repository";
import { CreateReviewUseCase } from "@/application/use-cases/review/create-review.use-case";
import { GetProfessionalRatingSummaryUseCase } from "@/application/use-cases/review/get-professional-rating-summary.use-case";
import { GetReviewByJobUseCase } from "@/application/use-cases/review/get-review-by-job.use-case";
import { ListProfessionalReviewsUseCase } from "@/application/use-cases/review/list-professional-reviews.use-case";

const reviews = new PrismaReviewRepository();
const jobs = new PrismaJobRepository();
const customerProfiles = new PrismaCustomerProfileRepository();
const professionals = new PrismaProfessionalRepository();

export function makeCreateReviewUseCase() {
  return new CreateReviewUseCase(reviews, jobs, customerProfiles, professionals);
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
