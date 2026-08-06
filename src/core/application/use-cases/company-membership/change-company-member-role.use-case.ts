import { NotFoundError, UnauthorizedError, ValidationError } from "@/domain/errors/domain-error";
import type { CompanyMemberRecord, CompanyMembershipRepository } from "@/domain/repositories/company-membership-repository";
import { canChangeMemberRole, deriveMembershipStatus, type CompanyMemberRoleValue } from "@/domain/services/company-membership-rules";
import { CompanyMembershipChanged } from "@/domain/events/company-membership-changed";
import type { EventBus } from "@/application/ports/event-bus";
import { EventDispatchError } from "@/application/ports/event-dispatch-error";
import { type FailureReporter, NullFailureReporter } from "@/application/ports/failure-reporter";
import { resolveCompanyActor } from "@/application/use-cases/company/resolve-company-actor";

/**
 * Module 18 — Company Professional: changes a member's role. Re-derives the
 * caller's own role from their session-scoped membership (never trusted
 * from client input) and re-checks `canChangeMemberRole` server-side
 * regardless of what the UI allowed. The target member must belong to the
 * same company the caller is resolved against — a memberId from a different
 * company surfaces as NotFoundError (never leaks whether that id exists
 * elsewhere).
 *
 * Module 37 — Domain Event Subscribers: this use case no longer writes the
 * audit log entry or notifies the affected member itself — both happen
 * because `CompanyMembershipChanged` is published through the Module 34
 * `EventBus`, reacted to by `RecordCompanyMembershipAuditLogSubscriber`/
 * `NotifyCompanyMembershipChangeSubscriber`. See
 * `SubmitProfessionalVerificationUseCase`'s own doc comment for the
 * identical publish-and-report-don't-rethrow rationale, mirrored here
 * exactly.
 */
export class ChangeCompanyMemberRoleUseCase {
  constructor(
    private readonly memberships: CompanyMembershipRepository,
    private readonly eventBus: EventBus,
    private readonly failureReporter: FailureReporter = new NullFailureReporter(),
  ) {}

  async execute(
    userId: string,
    companyId: string,
    memberId: string,
    newRole: CompanyMemberRoleValue,
  ): Promise<CompanyMemberRecord> {
    const actor = await resolveCompanyActor(userId, companyId, this.memberships);

    const target = await this.memberships.findById(memberId);
    if (!target || target.companyId !== companyId || deriveMembershipStatus(target) !== "ACTIVE") {
      throw new NotFoundError("CompanyMember", memberId);
    }

    if (target.id === actor.memberId) {
      throw new ValidationError("You cannot change your own role.");
    }

    if (!canChangeMemberRole(actor.role, target.role, newRole)) {
      throw new UnauthorizedError("You do not have permission to assign that role.");
    }

    const updated = await this.memberships.updateRole(memberId, newRole);

    try {
      await this.eventBus.publishAll([
        new CompanyMembershipChanged(
          companyId,
          memberId,
          target.userId,
          userId,
          "ROLE_CHANGED",
          target.role,
          newRole,
        ),
      ]);
    } catch (error) {
      if (!(error instanceof EventDispatchError)) throw error;
      this.failureReporter.report(error, { event: error.eventName, eventId: error.eventId });
    }

    return updated;
  }
}
