import { DomainEvent } from "@/domain/events/domain-event";

/**
 * Module 38 — GDPR Compliance.
 *
 * Raised when `PrepareAccountDeletionUseCase` is invoked — i.e. when a
 * deletion *plan/report* is produced, not when anything is actually
 * deleted (this module never performs an irreversible delete; see that use
 * case's own doc comment). Naming mirrors the request/prepare split already
 * used for export (`PersonalDataExportRequested`), but deletion has only
 * one event because "requested" and "plan prepared" happen synchronously,
 * in the same use case call, with no separate downstream step yet to mark
 * complete.
 */
export class AccountDeletionRequested extends DomainEvent {
  static readonly eventName = "gdpr.account_deletion.requested";

  constructor(
    readonly userId: string,
    readonly actorUserId: string,
  ) {
    super();
  }
}
