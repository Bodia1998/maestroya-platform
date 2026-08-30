import { ConflictError, NotFoundError } from "@/domain/errors/domain-error";
import { ProfessionalUpdated } from "@/domain/events/professional-updated";
import type { AdminAuditLogRepository } from "@/domain/repositories/admin-audit-log-repository";
import type { AdminProfessionalRecord, AdminRepository } from "@/domain/repositories/admin-repository";
import type { EventBus } from "@/application/ports/event-bus";
import { NullEventBus } from "@/application/ports/null-event-bus";
import { publishDomainEvent } from "@/application/services/events/publish-domain-event";
import { isSuspendableProfessionalStatus } from "@/domain/services/admin-rules";

/**
 * Module 83 — Professional Verification Enforcement.
 *
 * An admin suspends an individual professional (ProfessionalStatus:
 * ACTIVE -> SUSPENDED). Before this module there was no admin-initiated
 * suspension path for a solo professional at all — only a professional's
 * own self-service `DeactivateProfessionalUseCase` (-> INACTIVE) and the
 * fully separate company-side `SuspendCompanyUseCase`. Mirrors
 * `SuspendCompanyUseCase`/`AdminRepository.setCompanyStatus` exactly: one
 * repository (`AdminRepository`) owns both the read and the write, rather
 * than reading through `AdminRepository` and writing through the
 * professional-facing `ProfessionalRepository` — those are two separate
 * fake/production implementations that would otherwise never agree in
 * tests despite reading/writing the same underlying row in production.
 *
 * Takes effect immediately on every gate that reads
 * `ProfessionalProfile.status`: `CreateQuoteUseCase` (status !== ACTIVE is
 * already rejected), `PrismaProfessionalDiscoveryRepository`'s
 * `findActiveCandidatesByCategory`/`findCandidateById` (status: "ACTIVE"
 * in their `where` clause), and search indexing — a SUSPENDED professional
 * must also disappear from the search index, not just from these
 * synchronous reads, so this publishes `ProfessionalUpdated` exactly like
 * `DeactivateProfessionalUseCase` does for the same reason (see that use
 * case's own doc comment: `EnqueueSearchIndexSubscriber` re-reads
 * eligibility from the discovery repository and deletes the document once
 * it's no longer ACTIVE).
 */
export class AdminSuspendProfessionalUseCase {
  constructor(
    private readonly admins: AdminRepository,
    private readonly auditLog: AdminAuditLogRepository,
    private readonly eventBus: EventBus = new NullEventBus(),
  ) {}

  async execute(adminUserId: string, professionalId: string): Promise<AdminProfessionalRecord> {
    const target = await this.admins.getProfessionalById(professionalId);
    if (!target) throw new NotFoundError("ProfessionalProfile", professionalId);

    if (!isSuspendableProfessionalStatus(target.status)) {
      throw new ConflictError(`Professional is not in a suspendable state (current status: ${target.status}).`);
    }

    const updated = await this.admins.setProfessionalStatus(professionalId, "SUSPENDED");
    if (!updated) throw new NotFoundError("ProfessionalProfile", professionalId);

    await this.auditLog.record({
      adminUserId,
      action: "PROFESSIONAL_SUSPENDED",
      targetType: "ProfessionalProfile",
      targetId: professionalId,
      metadata: { previousStatus: target.status },
    });

    await publishDomainEvent(this.eventBus, new ProfessionalUpdated(professionalId, "status"));

    return updated;
  }
}
