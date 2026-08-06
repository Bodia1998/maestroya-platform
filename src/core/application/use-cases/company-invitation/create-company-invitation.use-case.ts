import { ConflictError, UnauthorizedError, ValidationError } from "@/domain/errors/domain-error";
import { CompanyInvitationStatusChanged } from "@/domain/events/company-invitation-status-changed";
import type { CompanyInvitationRecord, CompanyInvitationRepository } from "@/domain/repositories/company-invitation-repository";
import type { CompanyMembershipRepository } from "@/domain/repositories/company-membership-repository";
import type { UserRepository } from "@/domain/repositories/user-repository";
import { canInviteMembers, deriveMembershipStatus } from "@/domain/services/company-membership-rules";
import { computeInvitationExpiresAt, generateInvitationToken, isInvitableRole } from "@/domain/services/company-invitation-rules";
import type { EventBus } from "@/application/ports/event-bus";
import { EventDispatchError } from "@/application/ports/event-dispatch-error";
import { type FailureReporter, NullFailureReporter } from "@/application/ports/failure-reporter";
import type { CreateCompanyInvitationInput } from "@/application/dto/company-invitation.dto";
import { resolveCompanyActor } from "@/application/use-cases/company/resolve-company-actor";

export interface CreateCompanyInvitationResult {
  invitation: CompanyInvitationRecord;
  /** The raw, unhashed token — returned once, at creation time, so the
   *  caller (Server Action) can build the invitation link. Never persisted;
   *  only `tokenHash` is stored (see CompanyInvitation.tokenHash's doc
   *  comment). */
  token: string;
}

/**
 * Module 18 — Company Professional: invites an existing MaestroYa user to
 * join a company. Scope: existing users only, resolved server-side by
 * email — an email that doesn't match any account still creates the
 * invitation row (so a company can invite ahead of signup) but
 * `invitedUserId` stays null and AcceptCompanyInvitationUseCase requires the
 * *authenticated* accepting user's own email to match, so it can never be
 * accepted by an arbitrary account (see that use case).
 *
 * Only OWNER/ADMIN may invite (canInviteMembers). An invitation can never
 * grant OWNER (isInvitableRole excludes it — enforced here, not just in the
 * DTO). At most one PENDING invitation may exist per (companyId, email) —
 * checked here and backed by a DB partial unique index as the final
 * concurrency guarantee.
 *
 * Module 37 — Domain Event Subscribers: this use case no longer writes the
 * audit log entry or notifies the invited user itself — both happen
 * because `CompanyInvitationStatusChanged` is published through the
 * Module 34 `EventBus`, reacted to by
 * `RecordCompanyInvitationAuditLogSubscriber`/
 * `NotifyCompanyInvitationStatusChangeSubscriber`. See
 * `SubmitProfessionalVerificationUseCase`'s own doc comment for the
 * identical publish-and-report-don't-rethrow rationale, mirrored here
 * exactly.
 */
export class CreateCompanyInvitationUseCase {
  constructor(
    private readonly invitations: CompanyInvitationRepository,
    private readonly memberships: CompanyMembershipRepository,
    private readonly users: UserRepository,
    private readonly eventBus: EventBus,
    private readonly failureReporter: FailureReporter = new NullFailureReporter(),
  ) {}

  async execute(
    userId: string,
    companyId: string,
    input: CreateCompanyInvitationInput,
  ): Promise<CreateCompanyInvitationResult> {
    const actor = await resolveCompanyActor(userId, companyId, this.memberships);
    if (!canInviteMembers(actor.role)) {
      throw new UnauthorizedError("Only a company owner or admin may invite members.");
    }
    if (!isInvitableRole(input.role)) {
      throw new ValidationError("Invalid role for an invitation.");
    }

    const existingPending = await this.invitations.findPendingByCompanyAndEmail(companyId, input.email);
    if (existingPending) {
      throw new ConflictError("There is already a pending invitation for this email address.");
    }

    const invitedUser = await this.users.findByEmail(input.email);
    if (invitedUser) {
      const existingMembership = await this.memberships.findByCompanyAndUser(companyId, invitedUser.id);
      if (existingMembership && deriveMembershipStatus(existingMembership) === "ACTIVE") {
        throw new ConflictError("This user is already a member of the company.");
      }
    }

    const now = new Date();
    const { token, tokenHash } = generateInvitationToken();

    const invitation = await this.invitations.create({
      companyId,
      email: input.email,
      invitedUserId: invitedUser?.id ?? null,
      invitedByUserId: userId,
      role: input.role,
      tokenHash,
      expiresAt: computeInvitationExpiresAt(now),
    });

    try {
      await this.eventBus.publishAll([
        new CompanyInvitationStatusChanged(
          invitation.id,
          companyId,
          invitedUser?.id ?? null,
          userId,
          "PENDING",
          "CREATED",
          input.role,
          input.email,
        ),
      ]);
    } catch (error) {
      if (!(error instanceof EventDispatchError)) throw error;
      this.failureReporter.report(error, { event: error.eventName, eventId: error.eventId });
    }

    return { invitation, token };
  }
}
