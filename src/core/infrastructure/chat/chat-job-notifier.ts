import type { JobEvent, JobNotifier } from "@/application/ports/job-notifier";
import type { ConversationRepository } from "@/domain/repositories/conversation-repository";
import type { CustomerProfileRepository } from "@/domain/repositories/customer-profile-repository";
import type { MessageRepository } from "@/domain/repositories/message-repository";
import type { ProfessionalRepository } from "@/domain/repositories/professional-repository";
import type { ServiceRequestRepository } from "@/domain/repositories/service-request-repository";

/**
 * Order / Job Lifecycle module (Module 11): the only implementation of
 * JobNotifier, and — alongside ChatAppointmentNotifier — one of only two
 * places in the codebase where non-Chat code touches Chat's repositories.
 * Mirrors ChatAppointmentNotifier's own doc comment and behavior verbatim:
 * best-effort, silent-by-design about absence (never creates a
 * Conversation that doesn't already exist), and fails soft (a Chat-side
 * failure must never surface as a Job failure or roll back a Job
 * transaction — call sites wrap this in try/catch for exactly that
 * reason).
 */
export class ChatJobNotifier implements JobNotifier {
  constructor(
    private readonly serviceRequests: ServiceRequestRepository,
    private readonly customerProfiles: CustomerProfileRepository,
    private readonly professionals: ProfessionalRepository,
    private readonly conversations: ConversationRepository,
    private readonly messages: MessageRepository,
  ) {}

  async notify(event: JobEvent): Promise<void> {
    if (!event.professionalProfileId) {
      // Company-owned jobs aren't chat-integrated yet — same scope limit as
      // ChatAppointmentNotifier. No-op rather than error.
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
