import type { DeletionStrategyValue, GdprDataCategoryValue } from "@/domain/services/gdpr-privacy-rules";

/** One line item of an account-deletion plan/report — see
 *  `AccountDeletionPlan`. */
export interface AccountDeletionCategoryPlan {
  category: GdprDataCategoryValue;
  strategy: DeletionStrategyValue;
  /** Number of records this user has in this category, per
   *  `groupIntoGdprCategories` (`gdpr-data-inventory.ts`). */
  itemCount: number;
  /** Human-readable rationale for `strategy`, from
   *  `gdpr-privacy-rules.ts`'s `retentionReasonFor`. */
  reason: string;
}

/**
 * Module 38 — GDPR Compliance.
 *
 * The report `PrepareAccountDeletionUseCase` returns: an inventory of every
 * data category referencing the user, each classified into a deletion
 * strategy, with no deletion actually performed (see that use case's own
 * doc comment). Plain, JSON-serializable — same "just a read projection"
 * shape as `PersonalDataExport`.
 */
export interface AccountDeletionPlan {
  userId: string;
  preparedAt: Date;
  eligibleForDeletion: boolean;
  categories: AccountDeletionCategoryPlan[];
}
