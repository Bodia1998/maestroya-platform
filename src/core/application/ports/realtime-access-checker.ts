/**
 * Module 48 — Real-Time System.
 *
 * The resource-ownership checks `ChannelAuthorizationService` needs for
 * every non-"self" channel (`booking:{id}`, `dispute:{id}`, `chat:{id}`,
 * `company:{id}`, `professional:{id}`) but cannot answer on its own — that
 * requires a database read, which a pure domain/application authorization
 * service must not perform directly. `PrismaRealtimeAccessChecker`
 * (infrastructure layer) is the only implementation, and it deliberately
 * reuses this codebase's *existing* repositories (`JobRepository`,
 * `DisputeRepository`, `ConversationRepository`,
 * `CompanyMembershipRepository`, `ProfessionalRepository`) rather than
 * hand-rolling new Prisma queries — see that class's own doc comment.
 *
 * Every method answers "is `userId` a legitimate party to this resource"
 * — never throws for a missing resource, just returns `false` (an
 * unknown id is never accessible, the same as one that exists but belongs
 * to someone else).
 */
export interface RealtimeAccessChecker {
  isJobParticipant(userId: string, jobId: string): Promise<boolean>;
  isDisputeParticipant(userId: string, disputeId: string): Promise<boolean>;
  isConversationParticipant(userId: string, conversationId: string): Promise<boolean>;
  isCompanyMember(userId: string, companyProfileId: string): Promise<boolean>;
  isProfessionalOwner(userId: string, professionalProfileId: string): Promise<boolean>;
}
