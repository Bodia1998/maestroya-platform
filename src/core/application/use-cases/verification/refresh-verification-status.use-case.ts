import { NotFoundError } from "@/domain/errors/domain-error";
import type { AdminAuditLogRepository } from "@/domain/repositories/admin-audit-log-repository";
import type { ProfessionalRepository } from "@/domain/repositories/professional-repository";
import type {
  ProfessionalVerificationRecord,
  ProfessionalVerificationRepository,
} from "@/domain/repositories/professional-verification-repository";
import { canSyncProviderStatus, computeExpiresAt } from "@/domain/services/professional-verification-rules";
import { resolveProviderStatusTransition } from "@/domain/services/verification-provider-outcome";
import { NullNotificationCreator, type NotificationCreator } from "@/application/ports/notification-creator";
import type { VerificationProvider } from "@/application/ports/verification-provider";

export interface RefreshVerificationStatusResult {
  verification: ProfessionalVerificationRecord;
  /** `true` only when the case's own `status` changed as a result of this
   *  sync — `false` for "synced, provider still running" and for "nothing
   *  to sync" (MANUAL provider, no provider link, or a case not currently
   *  in a syncable state — see `canSyncProviderStatus`). */
  changed: boolean;
}

/**
 * Module 59 — Professional Verification (Persona): pulls the latest
 * decision for one case's Persona inquiry and, if it represents a legal
 * state change, applies it — the "RefreshVerificationStatus" use case from
 * the module brief. Also where "CompleteVerification"/"RejectVerification"
 * from that same brief are implemented: rather than two more use cases
 * duplicating this one's read-provider-then-transition-case logic for the
 * VERIFIED/REJECTED outcomes specifically, both are just the two most
 * common results of calling this one. "ExpireVerification" already exists
 * as `ExpireProfessionalVerificationsUseCase`
 * (application/use-cases/workflow-expiration/) for the `expiresAt`-driven
 * case; an EXPIRED provider outcome (Persona's own inquiry TTL) is handled
 * here for symmetry, following that use case's exact same "no profile
 * trust-badge change on expiry" scope boundary — see its own doc comment.
 *
 * Deliberately does not raise `ProfessionalVerificationStatusChanged` — a
 * provider-driven transition has no human actor (Persona is not a
 * `User`), which is exactly the situation
 * `ExpireProfessionalVerificationsUseCase` already established a
 * different, event-free pattern for: write the audit-log entry and
 * best-effort notification directly, both wrapped so a failure in either
 * never rolls back the (already-committed) status change. Mirrored here
 * verbatim rather than widening `ProfessionalVerificationStatusChanged`'s
 * `actorUserId: string` (non-null) contract or its subscribers'
 * exhaustive `transition` switches for a system-triggered case they were
 * never designed to describe.
 */
export class RefreshVerificationStatusUseCase {
  constructor(
    private readonly verifications: ProfessionalVerificationRepository,
    private readonly professionals: ProfessionalRepository,
    private readonly provider: VerificationProvider,
    private readonly auditLog: AdminAuditLogRepository,
    private readonly notifications: NotificationCreator = new NullNotificationCreator(),
  ) {}

  async execute(verificationId: string): Promise<RefreshVerificationStatusResult> {
    const verification = await this.verifications.findById(verificationId);
    if (!verification) {
      throw new NotFoundError("ProfessionalVerification", verificationId);
    }

    if (verification.provider === "MANUAL" || !verification.providerVerificationId) {
      return { verification, changed: false };
    }

    if (!canSyncProviderStatus(verification.status)) {
      return { verification, changed: false };
    }

    const result = await this.provider.refreshStatus(verification.providerVerificationId);
    const now = new Date();
    const nextStatus = resolveProviderStatusTransition(verification.status, result.outcome);

    if (!nextStatus) {
      const synced = await this.verifications.updateStatus(verification.id, {
        status: verification.status,
        providerStatus: result.rawStatus,
        providerSyncedAt: now,
      });
      return { verification: synced, changed: false };
    }

    const updated = await this.verifications.updateStatus(verification.id, {
      status: nextStatus,
      providerStatus: result.rawStatus,
      providerSyncedAt: now,
      ...(nextStatus === "APPROVED"
        ? { reviewedAt: now, expiresAt: computeExpiresAt(now), rejectionReason: null, resubmissionReason: null }
        : {}),
      ...(nextStatus === "REJECTED"
        ? { reviewedAt: now, rejectionReason: result.failureReason ?? "Automated identity verification was not successful." }
        : {}),
    });

    if (nextStatus === "APPROVED") {
      await this.verifications.setProfileVerificationStatus(verification.professionalProfileId, "VERIFIED", now);
    } else if (nextStatus === "REJECTED") {
      await this.verifications.setProfileVerificationStatus(verification.professionalProfileId, "REJECTED", null);
    }
    // UNDER_REVIEW / EXPIRED: no public trust-badge change — same boundary
    // ExpireProfessionalVerificationsUseCase documents for expiry, extended
    // here to "flagged for a human to look at" for the identical reason:
    // neither is itself a verdict on the professional.

    try {
      await this.auditLog.record({
        adminUserId: null,
        action:
          nextStatus === "APPROVED"
            ? "VERIFICATION_APPROVED"
            : nextStatus === "REJECTED"
              ? "VERIFICATION_REJECTED"
              : nextStatus === "EXPIRED"
                ? "VERIFICATION_EXPIRED"
                : "VERIFICATION_REVIEW_STARTED",
        targetType: "ProfessionalVerification",
        targetId: verification.id,
        metadata: {
          provider: verification.provider,
          providerVerificationId: verification.providerVerificationId,
          outcome: result.outcome,
          rawStatus: result.rawStatus,
        },
      });
    } catch (error) {
      console.error("Failed to record provider-verification-synced audit log", error);
    }

    if (nextStatus === "APPROVED" || nextStatus === "REJECTED") {
      try {
        const professional = await this.professionals.findById(verification.professionalProfileId);
        if (professional) {
          await this.notifications.notify({
            userId: professional.userId,
            type: nextStatus === "APPROVED" ? "VERIFICATION_APPROVED" : "VERIFICATION_REJECTED",
            title:
              nextStatus === "APPROVED"
                ? "You are now a verified professional"
                : "Verification request rejected",
            message:
              nextStatus === "APPROVED"
                ? "Your automated identity verification passed. A verified badge now appears on your public profile."
                : "Your automated identity verification was not successful. Open your verification page to see why and try again.",
            resourceType: "PROFESSIONAL_VERIFICATION",
            resourceId: verification.id,
            actionUrl: "/dashboard/professional/verification",
          });
        }
      } catch (error) {
        console.error("Failed to create provider-verification-synced notification", error);
      }
    }

    return { verification: updated, changed: true };
  }
}
