import { ConflictError, NotFoundError } from "@/domain/errors/domain-error";
import { CompanyStatusChanged } from "@/domain/events/company-status-changed";
import type { AdminCompanyRecord, AdminRepository } from "@/domain/repositories/admin-repository";
import type { EventBus } from "@/application/ports/event-bus";
import { EventDispatchError } from "@/application/ports/event-dispatch-error";
import { type FailureReporter, NullFailureReporter } from "@/application/ports/failure-reporter";
import { canTransitionCompanyStatus } from "@/domain/services/company-rules";

/**
 * Module 18 — Company Professional: an admin suspends a company
 * (ACTIVE/PENDING → SUSPENDED). Mirrors SuspendAdminUserUseCase — a thin,
 * auditable state transition, never a business-logic reimplementation.
 *
 * Module 37 — Domain Event Subscribers: this use case no longer writes the
 * audit log entry or notifies the company owner itself. Both were
 * independent side effects reacting to the same fact ("this company was
 * suspended") glued directly into this method; they now happen because
 * `CompanyStatusChanged` is published through the Module 34 `EventBus`,
 * and `RecordCompanyStatusChangeAuditLogSubscriber`/
 * `NotifyCompanyStatusChangeSubscriber` (registered from
 * `admin/compose.ts` and `notification/compose.ts`) react to it. The
 * business logic — validate the transition, persist the new status,
 * return the updated record — is unchanged.
 *
 * `EventDispatchError` (thrown by `EventBus.publish` when a subscriber
 * fails) is caught here and routed through `FailureReporter`, not
 * rethrown: the company's status has already been persisted by the time
 * `eventBus.publishAll` runs, so a subscriber failure (e.g. the
 * notification store is down) must not make this method — and therefore
 * the admin's request — appear to have failed. This is the same
 * best-effort guarantee the old inline `try/catch` around
 * `notifications.notify` gave the notification side specifically; it now
 * covers the audit-log side too, which previously had no such guarantee
 * (an audit-log write failure used to make the whole call reject even
 * though the status change had already committed).
 */
export class SuspendCompanyUseCase {
  constructor(
    private readonly admins: AdminRepository,
    private readonly eventBus: EventBus,
    private readonly failureReporter: FailureReporter = new NullFailureReporter(),
  ) {}

  async execute(adminUserId: string, companyId: string): Promise<AdminCompanyRecord> {
    const target = await this.admins.getCompanyById(companyId);
    if (!target) throw new NotFoundError("Company", companyId);

    if (!canTransitionCompanyStatus(target.status, "SUSPENDED")) {
      throw new ConflictError(`Company is not in a suspendable state (current status: ${target.status}).`);
    }

    const updated = await this.admins.setCompanyStatus(companyId, "SUSPENDED", new Date());
    if (!updated) throw new NotFoundError("Company", companyId);

    try {
      await this.eventBus.publishAll([
        new CompanyStatusChanged(companyId, target.ownerUserId, target.status, "SUSPENDED", adminUserId),
      ]);
    } catch (error) {
      if (!(error instanceof EventDispatchError)) throw error;
      this.failureReporter.report(error, { event: error.eventName, eventId: error.eventId });
    }

    return updated;
  }
}
