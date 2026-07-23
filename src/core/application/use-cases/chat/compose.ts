import { PrismaConversationRepository } from "@/infrastructure/database/prisma/repositories/prisma-conversation-repository";
import { PrismaCustomerProfileRepository } from "@/infrastructure/database/prisma/repositories/prisma-customer-profile-repository";
import { PrismaMessageRepository } from "@/infrastructure/database/prisma/repositories/prisma-message-repository";
import { PrismaProfessionalRepository } from "@/infrastructure/database/prisma/repositories/prisma-professional-repository";
import { PrismaQuoteRepository } from "@/infrastructure/database/prisma/repositories/prisma-quote-repository";
import { PrismaServiceRequestRepository } from "@/infrastructure/database/prisma/repositories/prisma-service-request-repository";
import { DeleteMessageUseCase } from "@/application/use-cases/chat/delete-message.use-case";
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

export function makeOpenConversationUseCase() {
  return new OpenConversationUseCase(customerProfiles, professionals, serviceRequests, quotes, conversations);
}

export function makeSendMessageUseCase() {
  return new SendMessageUseCase(conversations, messages);
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
