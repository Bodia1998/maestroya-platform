import { NotFoundError, UnauthorizedError } from "@/domain/errors/domain-error";
import type { CompanyMembershipRepository } from "@/domain/repositories/company-membership-repository";
import { canRemoveMember, deriveMembershipStatus } from "@/domain/services/company-membership-rules";
import { CompanyMembershipChanged } from "@/domain/events/company-membership-changed";
import type { EventBus } from "@/application/ports/event-bus";
import { EventDispatchError } from "@/application/ports/event-dispatch-error";
import { type FailureReporter, NullFailureReporter } from "@/application/ports/failure-reporter";
import { resolveCompanyActor } from "@/application/use-cases/company/resolve-company-actor";

/**
 * Module 18 — Company Professional: removes (soft-removes — sets
 * `removedAt`, never a hard delete) a member from a company. The OWNER can
 * never be removed this way, including by themself — ownership must be
 * transferred first (see TransferCompanyOwnershipUseCase and
 * canRemoveMember's own doc comment). A member may remove themself
 * (leaving the company) if their own role permits removing a member of
 * their own rank — MEMBER/MANAGER leaving is always allowed via this same
 * rule (canRemoveMember treats "removing yourself" as removing a member of
 * your own current role, which every role can do to itself except OWNER).
 *
 * Module 37 — Domain Event Subscribers: see
 * `ChangeCompanyMemberRoleUseCase`'s own doc comment — same rationale, same
 * `CompanyMembershipChanged` publish-and-report-don't-rethrow pattern,
 * mirrored here with `transition: "REMOVED"`.
 */
export class RemoveCompanyMemberUseCase {
  constructor(
    private readonly memberships: CompanyMembershipRepository,
    private readonly eventBus: EventBus,
    private readonly failureReporter: FailureReporter = new NullFailureReporter(),
  ) {}

  async execute(userId: string, companyId: string, memberId: string): Promise<void> {
    const actor = await resolveCompanyActor(userId, companyId, this.memberships);

    const target = await this.memberships.findById(memberId);
    if (!target || target.companyId !== companyId || deriveMembershipStatus(target) !== "ACTIVE") {
      throw new NotFoundError("CompanyMember", memberId);
    }

    const isSelfRemoval = target.id === actor.memberId;
    if (!isSelfRemoval && !canRemoveMember(actor.role, target.role)) {
      throw new UnauthorizedError("You do not have permission to remove this member.");
    }
    if (isSelfRemoval && target.role === "OWNER") {
      throw new UnauthorizedError("The company owner cannot leave without transferring ownership first.");
    }

    await this.memberships.remove(memberId, new Date());

    try {
      await this.eventBus.publishAll([
        new CompanyMembershipChanged(
          companyId,
          memberId,
          target.userId,
          userId,
          "REMOVED",
          target.role,
          null,
          isSelfRemoval,
        ),
      ]);
    } catch (error) {
      if (!(error instanceof EventDispatchError)) throw error;
      this.failureReporter.report(error, { event: error.eventName, eventId: error.eventId });
    }
  }
}
