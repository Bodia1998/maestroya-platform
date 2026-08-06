import { NotFoundError } from "@/domain/errors/domain-error";
import { AccountDeletionRequested } from "@/domain/events/account-deletion-requested";
import {
  classifyDataCategory,
  GDPR_DATA_CATEGORIES,
  isAccountDeletionPreparable,
  retentionReasonFor,
} from "@/domain/services/gdpr-privacy-rules";
import type { EventBus } from "@/application/ports/event-bus";
import { EventDispatchError } from "@/application/ports/event-dispatch-error";
import { type FailureReporter, NullFailureReporter } from "@/application/ports/failure-reporter";
import {
  collectUserDataInventory,
  groupIntoGdprCategories,
  type GdprInventoryRepos,
} from "@/application/use-cases/gdpr/gdpr-data-inventory";
import type { AccountDeletionPlan } from "@/application/use-cases/gdpr/account-deletion-plan.dto";

/**
 * Module 38 — GDPR Compliance: implements the GDPR Article 17 (right to
 * erasure) *preparation* step — given a userId, inventories every entity
 * referencing that user and classifies each into a deletion strategy
 * (hard-delete / anonymize / retain), returning a plan/report.
 *
 * **Never performs an irreversible delete or mutates any data.** This is a
 * read-only report a support/admin workflow (out of this module's scope)
 * would review before actually executing a deletion — see the module
 * brief's explicit "do not perform irreversible deletes" instruction. The
 * classification decision itself lives entirely in
 * `gdpr-privacy-rules.ts`'s `classifyDataCategory`/`retentionReasonFor` —
 * this use case only orchestrates gathering the counts
 * (`gdpr-data-inventory.ts`, shared with `ExportPersonalDataUseCase`) and
 * running them through that domain service.
 *
 * Publishes `AccountDeletionRequested` up front, same fire-and-report
 * convention as `ExportPersonalDataUseCase`'s own event publishing.
 */
export class PrepareAccountDeletionUseCase {
  constructor(
    private readonly repos: GdprInventoryRepos,
    private readonly eventBus: EventBus,
    private readonly failureReporter: FailureReporter = new NullFailureReporter(),
  ) {}

  async execute(userId: string, actorUserId: string = userId): Promise<AccountDeletionPlan> {
    const account = await this.repos.users.findById(userId);
    if (!account) {
      throw new NotFoundError("User", userId);
    }

    try {
      await this.eventBus.publishAll([new AccountDeletionRequested(userId, actorUserId)]);
    } catch (error) {
      if (!(error instanceof EventDispatchError)) throw error;
      this.failureReporter.report(error, { event: error.eventName, eventId: error.eventId });
    }

    const inventory = await collectUserDataInventory(userId, this.repos);
    const counts = groupIntoGdprCategories(inventory);

    const categories = GDPR_DATA_CATEGORIES.map((category) => ({
      category,
      strategy: classifyDataCategory(category),
      itemCount: counts[category],
      reason: retentionReasonFor(category),
    }));

    return {
      userId,
      preparedAt: new Date(),
      eligibleForDeletion: isAccountDeletionPreparable({ status: account.status }),
      categories,
    };
  }
}
