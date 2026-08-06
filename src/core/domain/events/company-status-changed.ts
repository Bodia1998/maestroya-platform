import { DomainEvent } from "@/domain/events/domain-event";

/**
 * Module 37 — Domain Event Subscribers (Notifications & Audit Log).
 *
 * Raised when an admin transitions a Company between `ACTIVE` and
 * `SUSPENDED` (see `SuspendCompanyUseCase`/`ReactivateCompanyUseCase`,
 * `application/use-cases/admin/`). This is the one genuinely new event
 * this module introduces — the concrete gap it closes: both use cases
 * already had two independent side effects glued directly into their
 * `execute()` bodies (write an `AdminAuditLogRepository` entry, best-effort
 * `NotificationCreator.notify` the company owner) — exactly the "several
 * unrelated reactions to one business fact" shape the Module 34 `EventBus`
 * exists for, just not wired through it yet. No other event was
 * introduced for this module: every other notification/audit call site in
 * the codebase either has no second independent side effect alongside it
 * (nothing to fan out) or is deliberately kept event-bus-free by its own
 * module's design (see `NotificationCreator`'s own doc comment — "no event
 * bus, no queue... same scope discipline" — a decision from Module 32 this
 * module does not revisit).
 *
 * `previousStatus`/`newStatus` are carried explicitly rather than inferred
 * from `eventName` alone so a single subscriber can react to both
 * directions without needing two near-duplicate handler classes — see
 * `RecordCompanyStatusChangeAuditLogSubscriber` and
 * `NotifyCompanyStatusChangeSubscriber`
 * (`application/use-cases/admin/` and `application/use-cases/notification/`
 * respectively).
 */
export class CompanyStatusChanged extends DomainEvent {
  static readonly eventName = "company.status-changed";

  constructor(
    readonly companyId: string,
    /** The company's owner — who any notification subscriber must notify.
     *  Resolved server-side by the publishing use case, same as every
     *  other `userId` this codebase puts on a `NotificationEvent`. */
    readonly ownerUserId: string,
    readonly previousStatus: "PENDING" | "ACTIVE" | "SUSPENDED" | "DEACTIVATED",
    readonly newStatus: "ACTIVE" | "SUSPENDED",
    /** The admin who performed the transition. `null` only for a future
     *  system-triggered transition with no human actor — mirrors
     *  `RecordAdminAuditLogData.adminUserId`'s own doc comment; every
     *  human-initiated transition today always supplies a real id. */
    readonly adminUserId: string | null,
  ) {
    super();
  }
}
