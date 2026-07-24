import { PrismaCustomerProfileRepository } from "@/infrastructure/database/prisma/repositories/prisma-customer-profile-repository";
import { PrismaProfessionalDiscoveryRepository } from "@/infrastructure/database/prisma/repositories/prisma-professional-discovery-repository";
import { PrismaProfessionalRepository } from "@/infrastructure/database/prisma/repositories/prisma-professional-repository";
import { PrismaQuoteAcceptanceRepository } from "@/infrastructure/database/prisma/repositories/prisma-quote-acceptance-repository";
import { PrismaQuoteRepository } from "@/infrastructure/database/prisma/repositories/prisma-quote-repository";
import { PrismaServiceRequestDiscoveryRepository } from "@/infrastructure/database/prisma/repositories/prisma-service-request-discovery-repository";
import { PrismaServiceRequestRepository } from "@/infrastructure/database/prisma/repositories/prisma-service-request-repository";
import { NotificationServiceCreator } from "@/infrastructure/notifications/notification-service";
import { AcceptQuoteUseCase } from "@/application/use-cases/quotes/accept-quote.use-case";
import { CreateQuoteUseCase } from "@/application/use-cases/quotes/create-quote.use-case";
import { GetAvailableServiceRequestsForProfessionalUseCase } from "@/application/use-cases/quotes/get-available-service-requests-for-professional.use-case";
import { GetProfessionalQuoteUseCase } from "@/application/use-cases/quotes/get-professional-quote.use-case";
import { GetProfessionalQuotesUseCase } from "@/application/use-cases/quotes/get-professional-quotes.use-case";
import { GetServiceRequestForProfessionalUseCase } from "@/application/use-cases/quotes/get-service-request-for-professional.use-case";
import { GetServiceRequestQuotesUseCase } from "@/application/use-cases/quotes/get-service-request-quotes.use-case";
import { UpdateQuoteUseCase } from "@/application/use-cases/quotes/update-quote.use-case";
import { WithdrawQuoteUseCase } from "@/application/use-cases/quotes/withdraw-quote.use-case";

const professionals = new PrismaProfessionalRepository();
const professionalDiscovery = new PrismaProfessionalDiscoveryRepository();
const requestDiscovery = new PrismaServiceRequestDiscoveryRepository();
const quotes = new PrismaQuoteRepository();
const serviceRequests = new PrismaServiceRequestRepository();
const customerProfiles = new PrismaCustomerProfileRepository();
const quoteAcceptance = new PrismaQuoteAcceptanceRepository();
const notifications = new NotificationServiceCreator();

export function makeGetAvailableServiceRequestsForProfessionalUseCase() {
  return new GetAvailableServiceRequestsForProfessionalUseCase(
    professionals,
    professionalDiscovery,
    requestDiscovery,
  );
}

export function makeGetServiceRequestForProfessionalUseCase() {
  return new GetServiceRequestForProfessionalUseCase(professionals, professionalDiscovery, requestDiscovery);
}

export function makeCreateQuoteUseCase() {
  return new CreateQuoteUseCase(professionals, professionalDiscovery, requestDiscovery, quotes, notifications);
}

export function makeUpdateQuoteUseCase() {
  return new UpdateQuoteUseCase(professionals, quotes);
}

export function makeWithdrawQuoteUseCase() {
  return new WithdrawQuoteUseCase(professionals, quotes);
}

export function makeGetProfessionalQuoteUseCase() {
  return new GetProfessionalQuoteUseCase(professionals, quotes);
}

export function makeGetProfessionalQuotesUseCase() {
  return new GetProfessionalQuotesUseCase(professionals, quotes, serviceRequests);
}

export function makeGetServiceRequestQuotesUseCase() {
  return new GetServiceRequestQuotesUseCase(customerProfiles, serviceRequests, quotes, professionalDiscovery);
}

export function makeAcceptQuoteUseCase() {
  return new AcceptQuoteUseCase(customerProfiles, serviceRequests, quotes, quoteAcceptance, professionals, notifications);
}
