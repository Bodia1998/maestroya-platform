import { ConflictError, NotFoundError } from "@/domain/errors/domain-error";
import type {
  ReconciliationDiscrepancyRecord,
  ReconciliationDiscrepancyRepository,
} from "@/domain/repositories/reconciliation-repository";
import type { EventBus } from "@/application/ports/event-bus";
import { type FailureReporter, NullFailureReporter } from "@/application/ports/failure-reporter";
import { publishDomainEvent } from "@/application/services/events/publish-domain-event";
import { DiscrepancyResolved } from "@/domain/events/discrepancy-resolved";
import { recordDiscrepancyResolved } from "@/infrastructure/observability/reconciliation-observability";

/**
 * Module 80 — Financial Reconciliation & Observability.
 *
 * The ONLY way a discrepancy's `resolutionStatus` ever changes — always a
 * deliberate, attributed admin action (`resolvedByUserId`/`resolvedAt`/
 * `reason`), never automatic. There is no "auto-resolve on next clean
 * run" mechanism: a discrepancy that stops being re-detected simply stops
 * being touched (see `createOrTouch`'s own doc comment) — it is NOT
 * marked resolved by that alone, because "no longer detected" is not
 * proof the underlying condition was ever actually fixed, only that this
 * run's scan didn't reach it. An admin must always explicitly close the
 * loop.
 */
export class ResolveDiscrepancyUseCase {
  constructor(
    private readonly discrepancies: ReconciliationDiscrepancyRepository,
    private readonly eventBus: EventBus,
    private readonly failureReporter: FailureReporter = new NullFailureReporter(),
  ) {}

  async execute(
    discrepancyId: string,
    resolvedByUserId: string,
    reason: string,
    metadata: Record<string, unknown> | null = null,
  ): Promise<ReconciliationDiscrepancyRecord> {
    const existing = await this.discrepancies.findById(discrepancyId);
    if (!existing) throw new NotFoundError("ReconciliationDiscrepancy", discrepancyId);
    if (existing.resolutionStatus === "RESOLVED") {
      throw new ConflictError(`Discrepancy ${discrepancyId} is already resolved.`);
    }

    const resolved = await this.discrepancies.resolve({
      id: discrepancyId,
      resolvedByUserId,
      resolvedAt: new Date(),
      reason,
      metadata,
    });

    recordDiscrepancyResolved({
      discrepancyId,
      resolvedByUserId,
      category: resolved.category,
      severity: resolved.severity,
    });
    await publishDomainEvent(
      this.eventBus,
      new DiscrepancyResolved(discrepancyId, resolvedByUserId, resolved.category, resolved.severity),
      this.failureReporter,
    );

    return resolved;
  }
}
