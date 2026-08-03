import { NullNotificationCreator } from "@/application/ports/notification-creator";
import type { NotificationCreator } from "@/application/ports/notification-creator";
import type { AdminAuditLogRepository } from "@/domain/repositories/admin-audit-log-repository";
import type { CustomerProfileRepository } from "@/domain/repositories/customer-profile-repository";
import type { ServiceRequestRepository } from "@/domain/repositories/service-request-repository";
import { isServiceRequestExpirable } from "@/domain/services/service-request-expiration-rules";

export interface ExpireServiceRequestsResult {
  expiredCount: number;
  ids: string[];
}

/**
 * Module 28 — Workflow Completion: batch use case invoked by the daily
 * expiration cron (see src/app/api/cron/expire-workflows/route.ts and
 * RunWorkflowExpirationsUseCase, its orchestrator). Transitions every
 * PUBLISHED/QUOTED ServiceRequest whose `expiresAt` has passed to EXPIRED.
 *
 * Deliberately re-checks `isServiceRequestExpirable` per row even though
 * `findExpirable` already filtered by the same rule at the query level —
 * defends against the repository's `now` and this use case's `now` ever
 * drifting apart (they're always the same `Date` instance passed down from
 * the orchestrator today, but a defensive re-check costs nothing and keeps
 * the domain rule as the single source of truth callers cannot bypass by
 * calling this use case with a stale/racy list).
 *
 * Same "best-effort side effects, never fail the batch" convention as every
 * other use case in this codebase — a single row's notification/audit-log
 * failure is logged and skipped, never aborts the rest of the batch.
 */
export class ExpireServiceRequestsUseCase {
  constructor(
    private readonly serviceRequests: ServiceRequestRepository,
    private readonly customerProfiles: CustomerProfileRepository,
    private readonly auditLog: AdminAuditLogRepository,
    private readonly notifications: NotificationCreator = new NullNotificationCreator(),
  ) {}

  async execute(now: Date): Promise<ExpireServiceRequestsResult> {
    const candidates = await this.serviceRequests.findExpirable(now);
    const expiredIds: string[] = [];

    for (const request of candidates) {
      if (!isServiceRequestExpirable(request.status, request.expiresAt ?? null, now)) {
        continue;
      }

      await this.serviceRequests.updateStatus(request.id, "EXPIRED");
      expiredIds.push(request.id);

      try {
        await this.auditLog.record({
          adminUserId: null,
          action: "SERVICE_REQUEST_EXPIRED",
          targetType: "ServiceRequest",
          targetId: request.id,
          metadata: { previousStatus: request.status, expiresAt: request.expiresAt?.toISOString() ?? null },
        });
      } catch (error) {
        console.error("Failed to record service-request-expired audit log", error);
      }

      try {
        const customer = await this.customerProfiles.findById(request.customerId);
        if (customer) {
          await this.notifications.notify({
            userId: customer.userId,
            type: "SERVICE_REQUEST_EXPIRED",
            title: "Your service request has expired",
            message: `Your request "${request.title}" has expired without being completed.`,
            resourceType: "SERVICE_REQUEST",
            resourceId: request.id,
            actionUrl: `/requests/${request.id}`,
            metadata: { serviceRequestId: request.id },
          });
        }
      } catch (error) {
        console.error("Failed to create service-request-expired notification", error);
      }
    }

    return { expiredCount: expiredIds.length, ids: expiredIds };
  }
}
