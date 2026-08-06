import { ConflictError, NotFoundError, UnauthorizedError } from "@/domain/errors/domain-error";
import { CompanyInvitationStatusChanged } from "@/domain/events/company-invitation-status-changed";
import type { CompanyInvitationRecord, CompanyInvitationRepository } from "@/domain/repositories/company-invitation-repository";
import type { UserRepository } from "@/domain/repositories/user-repository";
import { hashInvitationToken, isInvitationActionable } from "@/domain/services/company-invitation-rules";
import type { EventBus } from "@/application/ports/event-bus";
import { EventDispatchError } from "@/application/ports/event-dispatch-error";
import { type FailureReporter, NullFailureReporter } from "@/application/ports/failure-reporter";

/** Module 18 — Company Professional: declines a pending invitation. Same
 *  "belongs to this authenticated user" check as AcceptCompanyInvitationUseCase.
 *
 *  Module 37 — Domain Event Subscribers: this use case no longer writes the
 *  audit log entry or notifies the inviter itself — both happen because
 *  `CompanyInvitationStatusChanged` is published through the Module 34
 *  `EventBus`, reacted to by `RecordCompanyInvitationAuditLogSubscriber`/
 *  `NotifyCompanyInvitationStatusChangeSubscriber`. See
 *  `SubmitProfessionalVerificationUseCase`'s own doc comment for the
 *  identical publish-and-report-don't-rethrow rationale, mirrored here
 *  exactly. */
export class DeclineCompanyInvitationUseCase {
  constructor(
    private readonly invitations: CompanyInvitationRepository,
    private readonly users: UserRepository,
    private readonly eventBus: EventBus,
    private readonly failureReporter: FailureReporter = new NullFailureReporter(),
  ) {}

  async execute(userId: string, token: string): Promise<CompanyInvitationRecord> {
    const tokenHash = hashInvitationToken(token);
    const invitation = await this.invitations.findByTokenHash(tokenHash);
    if (!invitation) {
      throw new NotFoundError("CompanyInvitation", token);
    }

    if (!isInvitationActionable(invitation.status, invitation.expiresAt, new Date())) {
      throw new ConflictError("This invitation is no longer valid.");
    }

    const decliningUser = await this.users.findById(userId);
    const belongsToCaller = invitation.invitedUserId
      ? invitation.invitedUserId === userId
      : !!decliningUser?.email && decliningUser.email.toLowerCase() === invitation.email.toLowerCase();
    if (!belongsToCaller) {
      throw new UnauthorizedError("This invitation was not addressed to your account.");
    }

    const updated = await this.invitations.updateStatus(invitation.id, {
      status: "DECLINED",
      declinedAt: new Date(),
    });

    try {
      await this.eventBus.publishAll([
        new CompanyInvitationStatusChanged(
          invitation.id,
          invitation.companyId,
          invitation.invitedByUserId,
          userId,
          "DECLINED",
          "DECLINED",
        ),
      ]);
    } catch (error) {
      if (!(error instanceof EventDispatchError)) throw error;
      this.failureReporter.report(error, { event: error.eventName, eventId: error.eventId });
    }

    return updated;
  }
}
