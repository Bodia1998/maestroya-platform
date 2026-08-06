import { NotFoundError } from "@/domain/errors/domain-error";
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
 */
export class ExportPersonalDataUseCase {
  constructor(
    private readonly repos: GdprInventoryRepos,
    private readonly eventBus: EventBus,
    private readonly failureReporter: FailureReporter = new NullFailureReporter(),
  ) {}

  async execute(userId: string, actorUserId: string = userId): Promise<PersonalDataExport> {
    const account = await this.repos.users.findById(userId);
    if (!account) {
      throw new NotFoundError("User", userId);
    }

    await this.publish(new PersonalDataExportRequested(userId, actorUserId));

    const inventory = await collectUserDataInventory(userId, this.repos);

    await this.publish(new PersonalDataExportPrepared(userId, actorUserId, computeCategoryCounts(inventory)));

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
