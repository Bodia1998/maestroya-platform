import { ConflictError, NotFoundError } from "@/domain/errors/domain-error";
import { ProfessionalUpdated } from "@/domain/events/professional-updated";
import type { AdminAuditLogRepository } from "@/domain/repositories/admin-audit-log-repository";
import type { AdminProfessionalRecord, AdminRepository } from "@/domain/repositories/admin-repository";
import type { EventBus } from "@/application/ports/event-bus";
import { NullEventBus } from "@/application/ports/null-event-bus";
import { publishDomainEvent } from "@/application/services/events/publish-domain-event";
import { isReactivatableProfessionalStatus } from "@/domain/services/admin-rules";

/**
 * Module 83 — Professional Verification Enforcement.
 *
 * An admin reactivates an individually-SUSPENDED professional back to
 * ACTIVE. Mirrors `AdminSuspendProfessionalUseCase`/`ReactivateCompanyUseCase`
 * exactly (see that use case's own doc comment for why this reads and
 * writes through `AdminRepository` alone).
 *
 * Deliberately does not reactivate an INACTIVE professional (that status
 * is the professional's own deliberate choice via
 * `DeactivateProfessionalUseCase` — an admin reactivating a suspension can
 * never accidentally undo a professional's own deactivation, the same
 * separation `company-rules.ts` documents between admin-driven SUSPENDED
 * and owner-driven DEACTIVATED for companies).
 *
 * Reactivating alone does not make the professional operational again —
 * `CreateQuoteUseCase`/the discovery repository still separately require
 * `verificationStatus === "VERIFIED"` (Module 83's other gate), so a
 * professional whose verification was rejected while suspended stays
 * un-quotable/un-discoverable after reactivation until they are
 * re-verified, exactly as intended.
 */
export class AdminReactivateProfessionalUseCase {
  constructor(
    private readonly admins: AdminRepository,
    private readonly auditLog: AdminAuditLogRepository,
    private readonly eventBus: EventBus = new NullEventBus(),
  ) {}

  async execute(adminUserId: string, professionalId: string): Promise<AdminProfessionalRecord> {
    const target = await this.admins.getProfessionalById(professionalId);
    if (!target) throw new NotFoundError("ProfessionalProfile", professionalId);

    if (!isReactivatableProfessionalStatus(target.status)) {
      throw new ConflictError(`Professional is not in a reactivatable state (current status: ${target.status}).`);
    }

    const updated = await this.admins.setProfessionalStatus(professionalId, "ACTIVE");
    if (!updated) throw new NotFoundError("ProfessionalProfile", professionalId);

    await this.auditLog.record({
      adminUserId,
      action: "PROFESSIONAL_REACTIVATED",
      targetType: "ProfessionalProfile",
      targetId: professionalId,
      metadata: { previousStatus: target.status },
    });

    await publishDomainEvent(this.eventBus, new ProfessionalUpdated(professionalId, "status"));

    return updated;
  }
}
