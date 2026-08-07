import { buildSearchDocumentId, type SearchDocumentKind } from "@/domain/entities/search-document";
import type { SearchIndexProvider } from "@/application/ports/search-index-provider";
import { nullSearchObserver, type SearchObserver } from "@/application/ports/search-observer";
import type { SearchDocumentProjector } from "@/application/services/search/search-document-projector";

export interface BatchIndexSearchDocumentsInput {
  kind: SearchDocumentKind;
  entityIds: string[];
}

export interface BatchIndexSearchDocumentsResult {
  indexed: number;
  removed: number;
  durationMs: number;
}

/**
 * Module 47 — CQRS Search Engine (Roadmap Module 14).
 *
 * **Batch indexing** — re-projects many entities of one kind in a single
 * pass, with one provider round trip for the writes and one delete per
 * entity that no longer qualifies.
 *
 * Why this exists separately from calling `IndexSearchDocumentUseCase` in
 * a loop: the cost of indexing is dominated by the network round trip to
 * the search engine, not by the projection. Meilisearch and Typesense
 * both accept a documents *array* and process it as one task, so a
 * hundred-document batch is one request instead of a hundred — the
 * difference between a rebuild that takes minutes and one that takes
 * hours. `RebuildSearchIndexUseCase` is built entirely out of this.
 *
 * Duplicate ids within `entityIds` are harmless: the projection is
 * deterministic and document ids are derived from entity ids, so the
 * engine simply upserts the same document twice.
 *
 * An empty input is a legal no-op, so callers paginating over a source
 * never need a "was this page empty?" guard.
 */
export class BatchIndexSearchDocumentsUseCase {
  constructor(
    private readonly provider: SearchIndexProvider,
    private readonly projector: SearchDocumentProjector,
    private readonly observer: SearchObserver = nullSearchObserver,
    private readonly now: () => number = () => Date.now(),
  ) {}

  async execute(input: BatchIndexSearchDocumentsInput): Promise<BatchIndexSearchDocumentsResult> {
    const startedAt = this.now();

    if (input.entityIds.length === 0) {
      return { indexed: 0, removed: 0, durationMs: 0 };
    }

    try {
      const { documents, missingIds } = await this.projector.projectMany(input.kind, input.entityIds);

      await this.provider.indexDocuments(documents);

      // Removals stay per-document rather than one filtered bulk delete:
      // `deleteByFilter` selects by kind/age, not by an id set, and a
      // batch's ineligible entities are normally a handful at most.
      for (const entityId of missingIds) {
        await this.provider.deleteDocument(buildSearchDocumentId(input.kind, entityId));
      }

      const durationMs = this.now() - startedAt;
      this.observer.onBatchIndexed({
        kind: input.kind,
        indexed: documents.length,
        removed: missingIds.length,
        durationMs,
      });
      this.observer.onSyncCompleted({
        operation: "batch",
        documentCount: documents.length,
        completedAt: new Date(),
      });

      return { indexed: documents.length, removed: missingIds.length, durationMs };
    } catch (error) {
      this.observer.onError({ operation: "batch", kind: input.kind, error });
      throw error;
    }
  }
}
