import { ConflictError, NotFoundError } from "@/domain/errors/domain-error";
import { CompanyStatusChanged } from "@/domain/events/company-status-changed";
import type { AdminCompanyRecord, AdminRepository } from "@/domain/repositories/admin-repository";
import type { EventBus } from "@/application/ports/event-bus";
import { EventDispatchError } from "@/application/ports/event-dispatch-error";
import { type FailureReporter, NullFailureReporter } from "@/application/ports/failure-reporter";
import { canTransitionCompanyStatus } from "@/domain/services/company-rules";

/**
 * Module 18 — Company Professional: an admin reactivates a SUSPENDED
 * company back to ACTIVE. Mirrors ReactivateAdminUserUseCase.
 *
 * Module 37 — Domain Event Subscribers: see `SuspendCompanyUseCase`'s own
 * doc comment — same rationale, same `CompanyStatusChanged`
 * publish-and-report-don't-rethrow pattern, mirrored here exactly.
 */
export class ReactivateCompanyUseCase {
  constructor(
    private readonly admins: AdminRepository,
    private readonly eventBus: EventBus,
    private readonly failureReporter: FailureReporter = new NullFailureReporter(),
  ) {}

  async execute(adminUserId: string, companyId: string): Promise<AdminCompanyRecord> {
    const target = await this.admins.getCompanyById(companyId);
    if (!target) throw new NotFoundError("Company", companyId);

    if (!canTransitionCompanyStatus(target.status, "ACTIVE")) {
      throw new ConflictError(`Company is not in a reactivatable state (current status: ${target.status}).`);
    }

    const updated = await this.admins.setCompanyStatus(companyId, "ACTIVE", null);
    if (!updated) throw new NotFoundError("Company", companyId);

    try {
      await this.eventBus.publishAll([
        new CompanyStatusChanged(companyId, target.ownerUserId, target.status, "ACTIVE", adminUserId),
      ]);
    } catch (error) {
      if (!(error instanceof EventDispatchError)) throw error;
      this.failureReporter.report(error, { event: error.eventName, eventId: error.eventId });
    }

    return updated;
  }
}
