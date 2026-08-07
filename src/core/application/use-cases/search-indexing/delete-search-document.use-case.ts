import { buildSearchDocumentId, type SearchDocumentKind } from "@/domain/entities/search-document";
import type { SearchIndexProvider } from "@/application/ports/search-index-provider";
import { nullSearchObserver, type SearchObserver } from "@/application/ports/search-observer";

export interface DeleteSearchDocumentInput {
  kind: SearchDocumentKind;
  entityId: string;
}

/**
 * Module 47 — CQRS Search Engine (Roadmap Module 14).
 *
 * **Delete-from-index** — unconditional removal of one entity's document,
 * for the cases where the caller already knows the entity must not be
 * searchable and there is nothing left to re-read: a hard delete, a GDPR
 * erasure, or an operator pulling a listing.
 *
 * Distinct from `IndexSearchDocumentUseCase`'s removal branch, which is a
 * *derived* removal (the projection came back `null`). Keeping the two
 * separate matters because they have different failure meanings: an
 * unconditional delete for a row that no longer exists must succeed,
 * whereas an incremental index for a missing row is information — the
 * entity became ineligible — worth recording as such.
 *
 * Deleting an absent document is a no-op, never an error (the provider
 * port requires this). That is what makes the operation safely
 * re-runnable: a duplicate delete job, or a delete racing a rebuild's own
 * sweep, converges on the same state instead of failing and retrying
 * forever.
 */
export class DeleteSearchDocumentUseCase {
  constructor(
    private readonly provider: SearchIndexProvider,
    private readonly observer: SearchObserver = nullSearchObserver,
  ) {}

  async execute(input: DeleteSearchDocumentInput): Promise<{ documentId: string }> {
    const documentId = buildSearchDocumentId(input.kind, input.entityId);

    try {
      await this.provider.deleteDocument(documentId);
    } catch (error) {
      this.observer.onError({ operation: "delete", kind: input.kind, entityId: input.entityId, error });
      throw error;
    }

    this.observer.onRemoved({
      kind: input.kind,
      entityId: input.entityId,
      documentId,
      reason: "requested",
    });
    this.observer.onSyncCompleted({ operation: "delete", documentCount: 0, completedAt: new Date() });

    return { documentId };
  }
}
