import { DomainEvent } from "@/domain/events/domain-event";

/**
 * Module 38 — GDPR Compliance.
 *
 * Raised once `ExportPersonalDataUseCase` has finished assembling the
 * `PersonalDataExport` model and is about to return it. `categoryCounts`
 * mirrors `DisputeCreated`'s "carry just enough payload for a subscriber to
 * write a meaningful audit-log line without re-fetching anything" — never
 * the exported data itself (this event is not the delivery mechanism; see
 * the module's own scope note that ZIP/email delivery is out of scope).
 */
export class PersonalDataExportPrepared extends DomainEvent {
  static readonly eventName = "gdpr.personal_data_export.prepared";

  constructor(
    readonly userId: string,
    readonly actorUserId: string,
    /** Number of records included per export category (e.g.
     *  `{ serviceRequests: 3, jobsAsCustomer: 1, ... }`) — an at-a-glance
     *  summary for the audit log, not a full manifest. */
    readonly categoryCounts: Record<string, number>,
  ) {
    super();
  }
}
