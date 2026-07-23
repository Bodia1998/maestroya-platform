import type { AppointmentEvent, AppointmentNotifier } from "@/application/ports/appointment-notifier";
import type { ConversationRepository } from "@/domain/repositories/conversation-repository";
import type { CustomerProfileRepository } from "@/domain/repositories/customer-profile-repository";
import type { MessageRepository } from "@/domain/repositories/message-repository";
import type { ProfessionalRepository } from "@/domain/repositories/professional-repository";
import type { ServiceRequestRepository } from "@/domain/repositories/service-request-repository";

/**
 * Booking & Scheduling module (Module 10): the only implementation of
 * AppointmentNotifier, and the only place in the codebase where Booking
 * code touches Chat's repositories — see the port's doc comment for why
 * this direction (Booking -> Chat, never the reverse) matters.
 *
 * Deliberately best-effort and silent-by-design about *absence*: if no
 * Conversation exists yet for this (ServiceRequest, customer,
 * professional) triple, this does nothing — it never creates one. Opening
 * a Conversation is Chat's own eligibility-gated workflow
 * (OpenConversationUseCase); Booking does not get to trigger that
 * indirectly just by an appointment event happening, since a customer and
 * professional may never have exchanged a single message and shouldn't
 * have a thread manufactured for them by a side effect they didn't
 * initiate. Chat's own state/eligibility rules are never read or
 * evaluated here beyond the one lookup needed to find (or not find) the
 * existing thread.
 *
 * Also deliberately fails soft: a Chat-side failure (e.g. a transient DB
 * error resolving the conversation) must never surface as a Booking
 * failure or roll back a Booking transaction — notifying chat is a
 * side effect of a successful booking action, not a precondition for one.
 * Call sites (the booking use cases) wrap this in try/catch for exactly
 * that reason; this class itself only guards the "no conversation exists"
 * case, not unexpected errors, so real errors are still visible in logs
 * rather than being swallowed twice.
 */
export class ChatAppointmentNotifier implements AppointmentNotifier {
  constructor(
    private readonly serviceRequests: ServiceRequestRepository,
    private readonly customerProfiles: CustomerProfileRepository,
    private readonly professionals: ProfessionalRepository,
    private readonly conversations: ConversationRepository,
    private readonly messages: MessageRepository,
  ) {}

  async notify(event: AppointmentEvent): Promise<void> {
    if (!event.professionalProfileId) {
      // Company-owned appointments aren't chat-integrated yet — see this
      // module's "Future Extensions" scope note. No-op rather than error.
      return;
    }

    const request = await this.serviceRequests.findById(event.serviceRequestId);
    if (!request) return;

    const [customer, professional] = await Promise.all([
      this.customerProfiles.findById(request.customerId),
      this.professionals.findById(event.professionalProfileId),
    ]);
    if (!customer || !professional) return;

    const conversation = await this.conversations.findByServiceRequestAndParticipants(
      event.serviceRequestId,
      customer.userId,
      professional.userId,
    );
    if (!conversation) return;

    await this.messages.create({
      conversationId: conversation.id,
      senderId: event.actorUserId,
      body: event.message,
      type: "SYSTEM",
    });
  }
}
