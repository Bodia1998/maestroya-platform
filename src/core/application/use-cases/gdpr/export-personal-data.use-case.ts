import { NotFoundError, UnauthorizedError } from "@/domain/errors/domain-error";
import { PersonalDataExportRequested } from "@/domain/events/personal-data-export-requested";
import { PersonalDataExportPrepared } from "@/domain/events/personal-data-export-prepared";
import type { EventBus } from "@/application/ports/event-bus";
import { EventDispatchError } from "@/application/ports/event-dispatch-error";
import { type FailureReporter, NullFailureReporter } from "@/application/ports/failure-reporter";
import {
  collectUserDataInventory,
  computeCategoryCounts,
  type GdprInventoryRepos,
} from "@/application/use-cases/gdpr/gdpr-data-inventory";
import type { PersonalDataExport } from "@/application/use-cases/gdpr/personal-data-export.dto";

/**
 * Module 38 — GDPR Compliance: implements the GDPR Article 20 (data
 * portability) / Article 15 (right of access) request — given a userId,
 * gathers every GDPR-relevant record this platform can attribute to that
 * user and returns it as one in-memory `PersonalDataExport` model.
 *
 * Deliberately does **not** write a file, build a ZIP, upload to storage,
 * or send an email — see the module's own scope note. A future delivery
 * mechanism (Module-numbered separately) can call this use case and take
 * the returned model from there without this use case needing to change.
 *
 * Publishes `PersonalDataExportRequested` before gathering anything (the
 * request itself is always on the audit trail even if gathering later
 * throws) and `PersonalDataExportPrepared` once the model is fully
 * assembled — both fire-and-report, never rethrown, same convention as
 * `CreateDisputeUseCase`'s own event-publishing (see that class's doc
 * comment for the rationale: an audit-log/notification failure must never
 * fail the primary operation).
 *
 * Module 95 — API Security Hardening (IDOR finding): prior to this
 * module, `execute()` accepted an *unchecked* `actorUserId` string and
 * never verified it against `userId` — the only reason no live IDOR
 * existed was that nothing in `src/app` called this use case yet. That
 * made it a latent trap: the day a Server Action wired a
 * client-supplied `userId` into this use case, any authenticated user
 * could export any other user's full GDPR data inventory (messages,
 * reviews, audit-log entries, consent records, ...) with zero
 * repository-side defense. This now takes a typed `ExportPersonalDataActor`
 * and enforces the exact same rule `ExecuteAccountErasureUseCase` already
 * enforces for erasure: the actor must be exporting their own data, or
 * must be an admin. Every existing single-argument call site keeps
 * working unchanged (the default actor is "the subject exporting their
 * own data"), so this closes the gap without being a breaking change.
 */
export interface ExportPersonalDataActor {
  userId: string;
  isAdmin: boolean;
}

export class ExportPersonalDataUseCase {
  constructor(
    private readonly repos: GdprInventoryRepos,
    private readonly eventBus: EventBus,
    private readonly failureReporter: FailureReporter = new NullFailureReporter(),
  ) {}

  async execute(
    userId: string,
    actor: ExportPersonalDataActor = { userId, isAdmin: false },
  ): Promise<PersonalDataExport> {
    if (actor.userId !== userId && !actor.isAdmin) {
      throw new UnauthorizedError("You cannot export another user's personal data.");
    }

    const account = await this.repos.users.findById(userId);
    if (!account) {
      throw new NotFoundError("User", userId);
    }

    await this.publish(new PersonalDataExportRequested(userId, actor.userId));

    const inventory = await collectUserDataInventory(userId, this.repos);

    await this.publish(new PersonalDataExportPrepared(userId, actor.userId, computeCategoryCounts(inventory)));

    return inventory;
  }

  private async publish(event: PersonalDataExportRequested | PersonalDataExportPrepared): Promise<void> {
    try {
      await this.eventBus.publishAll([event]);
    } catch (error) {
      if (!(error instanceof EventDispatchError)) throw error;
      this.failureReporter.report(error, { event: error.eventName, eventId: error.eventId });
    }
  }
}
