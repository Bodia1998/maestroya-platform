import { PrismaConversationRepository } from "@/infrastructure/database/prisma/repositories/prisma-conversation-repository";
import { PrismaCustomerProfileRepository } from "@/infrastructure/database/prisma/repositories/prisma-customer-profile-repository";
import { PrismaJobRepository } from "@/infrastructure/database/prisma/repositories/prisma-job-repository";
import { PrismaMessageRepository } from "@/infrastructure/database/prisma/repositories/prisma-message-repository";
import { PrismaProfessionalRepository } from "@/infrastructure/database/prisma/repositories/prisma-professional-repository";
import { PrismaServiceRequestRepository } from "@/infrastructure/database/prisma/repositories/prisma-service-request-repository";
import { ChatJobNotifier } from "@/infrastructure/chat/chat-job-notifier";
import { NotificationServiceCreator } from "@/infrastructure/notifications/notification-service";
import { CancelJobUseCase } from "@/application/use-cases/job/cancel-job.use-case";
import { CompleteJobUseCase } from "@/application/use-cases/job/complete-job.use-case";
import { GetJobUseCase } from "@/application/use-cases/job/get-job.use-case";
import { ListJobsForCustomerUseCase } from "@/application/use-cases/job/list-jobs-for-customer.use-case";
import { ListJobsForProfessionalUseCase } from "@/application/use-cases/job/list-jobs-for-professional.use-case";
import { StartJobUseCase } from "@/application/use-cases/job/start-job.use-case";

const jobs = new PrismaJobRepository();
const customerProfiles = new PrismaCustomerProfileRepository();
const professionals = new PrismaProfessionalRepository();
const serviceRequests = new PrismaServiceRequestRepository();
const conversations = new PrismaConversationRepository();
const messages = new PrismaMessageRepository();

const notifier = new ChatJobNotifier(serviceRequests, customerProfiles, professionals, conversations, messages);
const notifications = new NotificationServiceCreator();

export function makeStartJobUseCase() {
  return new StartJobUseCase(jobs, customerProfiles, professionals, notifier, notifications);
}

export function makeCompleteJobUseCase() {
  return new CompleteJobUseCase(jobs, customerProfiles, professionals, notifier, notifications);
}

export function makeCancelJobUseCase() {
  return new CancelJobUseCase(jobs, customerProfiles, professionals, notifier, notifications);
}

export function makeGetJobUseCase() {
  return new GetJobUseCase(jobs, customerProfiles, professionals);
}

export function makeListJobsForCustomerUseCase() {
  return new ListJobsForCustomerUseCase(jobs, customerProfiles);
}

export function makeListJobsForProfessionalUseCase() {
  return new ListJobsForProfessionalUseCase(jobs, professionals);
}
