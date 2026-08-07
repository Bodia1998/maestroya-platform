import { buildSearchDocumentId, type SearchDocumentKind } from "@/domain/entities/search-document";
import type { SearchIndexProvider } from "@/application/ports/search-index-provider";
import { nullSearchObserver, type SearchObserver } from "@/application/ports/search-observer";
import type { SearchDocumentProjector } from "@/application/services/search/search-document-projector";

export interface IndexSearchDocumentInput {
  kind: SearchDocumentKind;
  entityId: string;
}

export interface IndexSearchDocumentResult {
  documentId: string;
  /** `"indexed"` when the entity was projected and written, `"removed"` when it is no longer eligible. */
  action: "indexed" | "removed";
}

/**
 * Module 47 — CQRS Search Engine (Roadmap Module 14).
 *
 * **Incremental indexing** — re-projects exactly one entity into the read
 * model. This is what the background worker runs for the overwhelming
 * majority of jobs: a professional edited their headline, a review
 * changed a rating, a company was verified.
 *
 * It performs both halves of "keep the index true":
 *
 *  - the entity still qualifies → upsert its document (idempotent, since
 *    the document id is derived from the entity id);
 *  - the entity is gone or no longer eligible → delete its document.
 *
 * Both outcomes are *successes*. A deactivated professional is not an
 * error to be retried; it is a removal to be performed. Collapsing them
 * here — rather than making the caller pre-decide which operation to
 * enqueue — is what makes the pipeline safe against races: whichever job
 * runs last re-reads current state and converges on the right answer,
 * regardless of the order two events arrived in.
 *
 * Provider errors are deliberately **not** caught. This use case only
 * ever runs inside a background job, where an exception is precisely the
 * right signal: Module 45's `Worker` retries it with exponential backoff
 * and dead-letters it once attempts are exhausted. Swallowing the error
 * here would silently leave the read model stale with no record of why.
 */
export class IndexSearchDocumentUseCase {
  constructor(
    private readonly provider: SearchIndexProvider,
    private readonly projector: SearchDocumentProjector,
    private readonly observer: SearchObserver = nullSearchObserver,
    private readonly now: () => number = () => Date.now(),
  ) {}

  async execute(input: IndexSearchDocumentInput): Promise<IndexSearchDocumentResult> {
    const documentId = buildSearchDocumentId(input.kind, input.entityId);
    const startedAt = this.now();

    try {
      const document = await this.projector.project(input.kind, input.entityId);

      if (!document) {
        await this.provider.deleteDocument(documentId);
        this.observer.onRemoved({
          kind: input.kind,
          entityId: input.entityId,
          documentId,
          reason: "ineligible",
        });
        this.observer.onSyncCompleted({ operation: "index", documentCount: 0, completedAt: new Date() });
        return { documentId, action: "removed" };
      }

      await this.provider.indexDocument(document);
      this.observer.onIndexed({
        kind: input.kind,
        entityId: input.entityId,
        documentId,
        durationMs: this.now() - startedAt,
      });
      this.observer.onSyncCompleted({ operation: "index", documentCount: 1, completedAt: new Date() });
      return { documentId, action: "indexed" };
    } catch (error) {
      this.observer.onError({ operation: "index", kind: input.kind, entityId: input.entityId, error });
      throw error;
    }
  }
}
