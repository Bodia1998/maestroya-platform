import { PrismaAppointmentRepository } from "@/infrastructure/database/prisma/repositories/prisma-appointment-repository";
import { PrismaConversationRepository } from "@/infrastructure/database/prisma/repositories/prisma-conversation-repository";
import { PrismaCustomerProfileRepository } from "@/infrastructure/database/prisma/repositories/prisma-customer-profile-repository";
import { PrismaMessageRepository } from "@/infrastructure/database/prisma/repositories/prisma-message-repository";
import { PrismaProfessionalRepository } from "@/infrastructure/database/prisma/repositories/prisma-professional-repository";
import { PrismaServiceRequestRepository } from "@/infrastructure/database/prisma/repositories/prisma-service-request-repository";
import { ChatAppointmentNotifier } from "@/infrastructure/chat/chat-appointment-notifier";
import { CancelAppointmentUseCase } from "@/application/use-cases/booking/cancel-appointment.use-case";
import { ConfirmAppointmentUseCase } from "@/application/use-cases/booking/confirm-appointment.use-case";
import { GetAppointmentUseCase } from "@/application/use-cases/booking/get-appointment.use-case";
import { ListAppointmentsForCustomerUseCase } from "@/application/use-cases/booking/list-appointments-for-customer.use-case";
import { ListAppointmentsForProfessionalUseCase } from "@/application/use-cases/booking/list-appointments-for-professional.use-case";
import { ProposeAppointmentTimeUseCase } from "@/application/use-cases/booking/propose-appointment-time.use-case";
import { RescheduleAppointmentUseCase } from "@/application/use-cases/booking/reschedule-appointment.use-case";

const appointments = new PrismaAppointmentRepository();
const customerProfiles = new PrismaCustomerProfileRepository();
const professionals = new PrismaProfessionalRepository();
const serviceRequests = new PrismaServiceRequestRepository();
const conversations = new PrismaConversationRepository();
const messages = new PrismaMessageRepository();

const notifier = new ChatAppointmentNotifier(serviceRequests, customerProfiles, professionals, conversations, messages);

export function makeProposeAppointmentTimeUseCase() {
  return new ProposeAppointmentTimeUseCase(appointments, customerProfiles, professionals, serviceRequests, notifier);
}

export function makeConfirmAppointmentUseCase() {
  return new ConfirmAppointmentUseCase(appointments, customerProfiles, professionals, serviceRequests, notifier);
}

export function makeCancelAppointmentUseCase() {
  return new CancelAppointmentUseCase(appointments, customerProfiles, professionals, serviceRequests, notifier);
}

export function makeRescheduleAppointmentUseCase() {
  return new RescheduleAppointmentUseCase(appointments, customerProfiles, professionals, serviceRequests, notifier);
}

export function makeGetAppointmentUseCase() {
  return new GetAppointmentUseCase(appointments, customerProfiles, professionals, serviceRequests);
}

export function makeListAppointmentsForCustomerUseCase() {
  return new ListAppointmentsForCustomerUseCase(appointments, customerProfiles);
}

export function makeListAppointmentsForProfessionalUseCase() {
  return new ListAppointmentsForProfessionalUseCase(appointments, professionals);
}
