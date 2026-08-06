import { DomainEvent } from "@/domain/events/domain-event";

/**
 * Module 38 — GDPR Compliance.
 *
 * Raised at the very start of `ExportPersonalDataUseCase.execute` — before
 * any data is actually gathered — so the request itself is always on the
 * audit trail even if gathering later fails partway through (mirrors
 * `DisputeCreated`'s "publish once the fact is true, not once every
 * downstream side effect has succeeded" convention).
 */
export class PersonalDataExportRequested extends DomainEvent {
  static readonly eventName = "gdpr.personal_data_export.requested";

  constructor(
    /** The user whose data is being exported. */
    readonly userId: string,
    /** Who triggered the export — almost always the same as `userId` (a
     *  user exporting their own data), but kept separate so an
     *  admin-initiated export on a user's behalf (e.g. in response to a
     *  support ticket) is still attributable to the actual actor. */
    readonly actorUserId: string,
  ) {
    super();
  }
}
