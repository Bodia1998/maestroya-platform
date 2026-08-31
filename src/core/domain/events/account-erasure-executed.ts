import { DomainEvent } from "@/domain/events/domain-event";
import type { DeletionStrategyValue, GdprDataCategoryValue } from "@/domain/services/gdpr-privacy-rules";

/**
 * Module 88 — GDPR Erasure Execution & Document Retention.
 *
 * Raised once `ExecuteAccountErasureUseCase` finishes — the "erasure
 * executed" state in this module's lifecycle (Active -> Erasure requested
 * [`AccountDeletionRequested`, Module 38] -> Erasure executed [this event]
 * -> Retained legal/financial records). Carries per-category *strategies
 * applied*, never any personal data itself or even record counts (unlike
 * `PersonalDataExportPrepared`'s counts — see that event's own doc
 * comment for why counts are fine there; here the audit-log subscriber
 * that consumes this event writes straight to the permanent audit trail,
 * and this module's own instruction is explicit that the audit record
 * must carry only the minimum needed to prove erasure happened).
 *
 * Fired on every execution, including an idempotent no-op replay of an
 * already-erased account (`alreadyErased: true`) — the audit trail should
 * show every time erasure was invoked, not just the one that did work.
 */
export class AccountErasureExecuted extends DomainEvent {
  static readonly eventName = "gdpr.account_erasure.executed";

  constructor(
    readonly userId: string,
    readonly actorUserId: string,
    readonly alreadyErased: boolean,
    readonly categoriesProcessed: Partial<Record<GdprDataCategoryValue, DeletionStrategyValue>>,
    readonly documentsStoragePurgeFailures: number,
  ) {
    super();
  }
}
