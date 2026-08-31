import { PrismaConversationRepository } from "@/infrastructure/database/prisma/repositories/prisma-conversation-repository";
import { PrismaCustomerProfileRepository } from "@/infrastructure/database/prisma/repositories/prisma-customer-profile-repository";
import { PrismaMessageRepository } from "@/infrastructure/database/prisma/repositories/prisma-message-repository";
import { PrismaProfessionalRepository } from "@/infrastructure/database/prisma/repositories/prisma-professional-repository";
import { PrismaQuoteRepository } from "@/infrastructure/database/prisma/repositories/prisma-quote-repository";
import { PrismaServiceRequestRepository } from "@/infrastructure/database/prisma/repositories/prisma-service-request-repository";
import { PrismaOffPlatformDetectionRepository } from "@/infrastructure/database/prisma/repositories/prisma-off-platform-detection-repository";
import { PrismaTrustAutomatedActionRepository } from "@/infrastructure/database/prisma/repositories/prisma-trust-automated-action-repository";
import { PrismaTrustProfileRepository } from "@/infrastructure/database/prisma/repositories/prisma-trust-profile-repository";
import { createOffPlatformDetectionProvider } from "@/infrastructure/trust-integrity/trust-integrity-provider-factory";
import { NotificationServiceCreator } from "@/infrastructure/notifications/notification-service";
import { eventBus } from "@/infrastructure/events/compose";
import { DeleteMessageUseCase } from "@/application/use-cases/chat/delete-message.use-case";
import { RecordUserBehaviorSignalUseCase } from "@/application/use-cases/trust-integrity/record-user-behavior-signal.use-case";
import { DetectOffPlatformCommunicationUseCase } from "@/application/use-cases/trust-integrity/detect-off-platform-communication.use-case";
import { GetUnreadCountUseCase } from "@/application/use-cases/chat/get-unread-count.use-case";
import { ListConversationsUseCase } from "@/application/use-cases/chat/list-conversations.use-case";
import { ListMessagesUseCase } from "@/application/use-cases/chat/list-messages.use-case";
import { MarkConversationReadUseCase } from "@/application/use-cases/chat/mark-conversation-read.use-case";
import { OpenConversationUseCase } from "@/application/use-cases/chat/open-conversation.use-case";
import { SendMessageUseCase } from "@/application/use-cases/chat/send-message.use-case";

const customerProfiles = new PrismaCustomerProfileRepository();
const professionals = new PrismaProfessionalRepository();
const serviceRequests = new PrismaServiceRequestRepository();
const quotes = new PrismaQuoteRepository();
const conversations = new PrismaConversationRepository();
const messages = new PrismaMessageRepository();
const notifications = new NotificationServiceCreator();
// Module 89 — Fraud & Trust Signal Activation: read-only
// MESSAGING_RESTRICTION enforcement, plus feeding sent message bodies to
// Module 65's off-platform detection rule engine. Fresh Prisma
// repositories constructed directly here (never imported from
// trust-integrity/compose.ts) — mirrors the exact "each compose.ts
// constructs its own cross-module dependencies from Prisma repositories
// directly" convention job/compose.ts's own doc comment documents, and
// payments/compose.ts already follows for this same
// TrustAutomatedActionRepository.
const trustAutomatedActions = new PrismaTrustAutomatedActionRepository();
const trustProfiles = new PrismaTrustProfileRepository();
const offPlatformDetectionEvents = new PrismaOffPlatformDetectionRepository();

function makeDetectOffPlatformCommunicationUseCase() {
  return new DetectOffPlatformCommunicationUseCase(
    createOffPlatformDetectionProvider(),
    offPlatformDetectionEvents,
    new RecordUserBehaviorSignalUseCase(trustProfiles, eventBus),
    eventBus,
  );
}

export function makeOpenConversationUseCase() {
  return new OpenConversationUseCase(customerProfiles, professionals, serviceRequests, quotes, conversations);
}

export function makeSendMessageUseCase() {
  return new SendMessageUseCase(
    conversations,
    messages,
    notifications,
    trustAutomatedActions,
    makeDetectOffPlatformCommunicationUseCase(),
  );
}

export function makeListMessagesUseCase() {
  return new ListMessagesUseCase(conversations, messages);
}

export function makeListConversationsUseCase() {
  return new ListConversationsUseCase(conversations);
}

export function makeMarkConversationReadUseCase() {
  return new MarkConversationReadUseCase(conversations);
}

export function makeGetUnreadCountUseCase() {
  return new GetUnreadCountUseCase(conversations);
}

export function makeDeleteMessageUseCase() {
  return new DeleteMessageUseCase(messages);
}
