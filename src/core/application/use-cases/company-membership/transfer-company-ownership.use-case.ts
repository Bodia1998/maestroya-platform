import { NotFoundError, UnauthorizedError, ValidationError } from "@/domain/errors/domain-error";
import type { CompanyRepository } from "@/domain/repositories/company-repository";
import type { CompanyMembershipRepository } from "@/domain/repositories/company-membership-repository";
import {
  canInitiateOwnershipTransfer,
  deriveMembershipStatus,
  isEligibleOwnershipTransferTarget,
} from "@/domain/services/company-membership-rules";
import { CompanyMembershipChanged } from "@/domain/events/company-membership-changed";
import type { EventBus } from "@/application/ports/event-bus";
import { EventDispatchError } from "@/application/ports/event-dispatch-error";
import { type FailureReporter, NullFailureReporter } from "@/application/ports/failure-reporter";
import { resolveCompanyActor } from "@/application/use-cases/company/resolve-company-actor";

/**
 * Module 18 — Company Professional: transfers company ownership from the
 * current OWNER to another existing, active member — the only path by which
 * OWNER ever changes hands (see canInitiateOwnershipTransfer/
 * isEligibleOwnershipTransferTarget). Updates CompanyProfile.ownerUserId and
 * both members' roles (outgoing OWNER → ADMIN, incoming → OWNER) — the
 * repository is expected to perform this atomically (see
 * CompanyMembershipRepository.transferOwnership's own doc comment).
 *
 * Module 37 — Domain Event Subscribers: see
 * `ChangeCompanyMemberRoleUseCase`'s own doc comment — same rationale, same
 * `CompanyMembershipChanged` publish-and-report-don't-rethrow pattern,
 * mirrored here with `transition: "OWNERSHIP_TRANSFERRED"`. Only the
 * incoming owner is notified/audited by member id — see the event's own
 * doc comment for why the outgoing owner's role flip doesn't get a second
 * notification.
 */
export class TransferCompanyOwnershipUseCase {
  constructor(
    private readonly companies: CompanyRepository,
    private readonly memberships: CompanyMembershipRepository,
    private readonly eventBus: EventBus,
    private readonly failureReporter: FailureReporter = new NullFailureReporter(),
  ) {}

  async execute(userId: string, companyId: string, newOwnerMemberId: string): Promise<void> {
    const actor = await resolveCompanyActor(userId, companyId, this.memberships);
    if (!canInitiateOwnershipTransfer(actor.role)) {
      throw new UnauthorizedError("Only the current company owner may transfer ownership.");
    }

    const target = await this.memberships.findById(newOwnerMemberId);
    if (!target || target.companyId !== companyId) {
      throw new NotFoundError("CompanyMember", newOwnerMemberId);
    }

    const targetStatus = deriveMembershipStatus(target);
    if (!isEligibleOwnershipTransferTarget(targetStatus, target.id === actor.memberId)) {
      throw new ValidationError("Ownership can only be transferred to another active member of this company.");
    }

    await this.memberships.transferOwnership(companyId, actor.memberId, target.id);
    await this.companies.updateOwner(companyId, target.userId);

    try {
      await this.eventBus.publishAll([
        new CompanyMembershipChanged(companyId, target.id, target.userId, userId, "OWNERSHIP_TRANSFERRED"),
      ]);
    } catch (error) {
      if (!(error instanceof EventDispatchError)) throw error;
      this.failureReporter.report(error, { event: error.eventName, eventId: error.eventId });
    }
  }
}
