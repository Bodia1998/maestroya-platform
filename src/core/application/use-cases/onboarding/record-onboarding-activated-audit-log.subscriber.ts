import type { AdminAuditLogRepository } from "@/domain/repositories/admin-audit-log-repository";
import type { ProfessionalOnboardingActivated } from "@/domain/events/professional-onboarding-activated";
import type { EventHandler } from "@/application/ports/event-bus";

/**
 * Module 62 — Professional Onboarding.
 *
 * The `AuditLogSubscriber` for `ProfessionalOnboardingActivated` — mirrors
 * `RecordProfessionalVerificationAuditLogSubscriber` (Module 37/17)
 * exactly: no business logic, just translating the event's fields into
 * `RecordAdminAuditLogData` and delegating to the existing
 * `AdminAuditLogRepository`. `adminUserId` is the professional themselves
 * (see `ONBOARDING_ACTIVATED`'s own doc comment on `AdminAuditAction`).
 *
 * Registered against the shared `eventBus` from `onboarding/compose.ts`,
 * following the exact registration pattern `verification/compose.ts`
 * documents.
 */
export class RecordOnboardingActivatedAuditLogSubscriber implements EventHandler<ProfessionalOnboardingActivated> {
  constructor(private readonly auditLog: AdminAuditLogRepository) {}

  async handle(event: ProfessionalOnboardingActivated): Promise<void> {
    await this.auditLog.record({
      adminUserId: event.userId,
      action: "ONBOARDING_ACTIVATED",
      targetType: "ProfessionalOnboarding",
      targetId: event.onboardingId,
      metadata: { professionalProfileId: event.professionalProfileId, activatedAt: event.activatedAt.toISOString() },
    });
  }
}
