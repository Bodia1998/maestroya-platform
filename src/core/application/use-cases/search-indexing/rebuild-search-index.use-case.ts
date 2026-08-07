import type { SearchDocumentKind } from "@/domain/entities/search-document";
import type { CompanyDiscoveryRepository } from "@/domain/repositories/company-discovery-repository";
import type { ProfessionalDiscoveryRepository } from "@/domain/repositories/professional-discovery-repository";
import type { SearchIndexProvider } from "@/application/ports/search-index-provider";
import { nullSearchObserver, type SearchObserver } from "@/application/ports/search-observer";
import type { BatchIndexSearchDocumentsUseCase } from "@/application/use-cases/search-indexing/batch-index-search-documents.use-case";

export interface RebuildSearchIndexInput {
  /** Restrict the rebuild to certain kinds. Defaults to every rebuildable kind. */
  kinds?: SearchDocumentKind[];
  /** Documents per provider round trip. Defaults to 100. */
  batchSize?: number;
}

export interface RebuildSearchIndexKindReport {
  kind: SearchDocumentKind;
  candidates: number;
  indexed: number;
  batches: number;
  /** Stale documents swept after the pass (entities that vanished since the last sync). */
  sweptStale: number;
}

export interface RebuildSearchIndexReport {
  startedAt: string;
  completedAt: string;
  durationMs: number;
  totalIndexed: number;
  totalSweptStale: number;
  kinds: RebuildSearchIndexKindReport[];
}

/** Kinds a full rebuild can enumerate — see the class doc for why this is not every kind. */
export const REBUILDABLE_SEARCH_DOCUMENT_KINDS: readonly SearchDocumentKind[] = ["PROFESSIONAL", "COMPANY"];

const DEFAULT_BATCH_SIZE = 100;

/**
 * Module 47 — CQRS Search Engine (Roadmap Module 14).
 *
 * **Full rebuild** — re-projects the entire read model from the write
 * model. The operational backstop that makes every other guarantee in
 * this module affordable: because the index is derived data and can
 * always be regenerated from Postgres, a lost job, a dead-lettered event,
 * a corrupted index, or a schema change to `SearchDocument` are all
 * recoverable by running this, rather than by making the incremental path
 * transactional with the write model (which would couple the two and
 * defeat the point of CQRS).
 *
 * ## Why the rebuild is *safe* (no empty-index window)
 * It never clears the index first. Instead:
 *
 *  1. `startedAt` is captured.
 *  2. Every eligible entity is re-indexed in batches. Each write stamps a
 *     fresh `indexedAt`.
 *  3. Only then is `deleteByFilter({ kind, indexedBefore: startedAt })`
 *     issued, removing exactly the documents this pass did *not* touch —
 *     i.e. entities that disappeared or became ineligible since the last
 *     sync.
 *
 * Search therefore keeps serving complete results for the whole rebuild;
 * the worst a concurrent query sees is a document a few minutes stale,
 * which is the eventual-consistency contract the module already makes.
 * The sweep is also what makes the rebuild *idempotent*: running it twice
 * in a row leaves the index byte-identical, and running it after a
 * partially-failed run repairs that run rather than compounding it.
 *
 * ## Why `SERVICE_REQUEST` is not rebuilt
 * Rebuilding a kind requires enumerating every eligible entity of it.
 * Professionals and companies have exactly that in the Module 19
 * discovery repositories (`searchCandidates({})` — ACTIVE-only, enforced
 * in SQL). Service requests have no such repository read, and adding one
 * would mean changing an existing repository interface that this module
 * is explicitly not allowed to touch. Service-request documents are
 * therefore incrementally maintained (create/update/close events) and
 * self-healing over time — every open request is re-projected on its next
 * edit and removed when it leaves the open states. Adding a
 * `findOpenRequests()` read is the one-line follow-up that would make
 * this kind rebuildable; the report's per-kind shape already accommodates
 * it.
 */
export class RebuildSearchIndexUseCase {
  constructor(
    private readonly provider: SearchIndexProvider,
    private readonly batchIndex: BatchIndexSearchDocumentsUseCase,
    private readonly professionals: ProfessionalDiscoveryRepository,
    private readonly companies: CompanyDiscoveryRepository,
    private readonly observer: SearchObserver = nullSearchObserver,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async execute(input: RebuildSearchIndexInput = {}): Promise<RebuildSearchIndexReport> {
    const startedAt = this.now();
    const batchSize = Math.max(1, input.batchSize ?? DEFAULT_BATCH_SIZE);
    const kinds = (input.kinds ?? REBUILDABLE_SEARCH_DOCUMENT_KINDS).filter((kind) =>
      REBUILDABLE_SEARCH_DOCUMENT_KINDS.includes(kind),
    );

    const reports: RebuildSearchIndexKindReport[] = [];

    try {
      for (const kind of kinds) {
        reports.push(await this.rebuildKind(kind, batchSize, startedAt));
      }
    } catch (error) {
      this.observer.onError({ operation: "rebuild", error });
      throw error;
    }

    const completedAt = this.now();
    const report: RebuildSearchIndexReport = {
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      durationMs: completedAt.getTime() - startedAt.getTime(),
      totalIndexed: reports.reduce((sum, entry) => sum + entry.indexed, 0),
      totalSweptStale: reports.reduce((sum, entry) => sum + entry.sweptStale, 0),
      kinds: reports,
    };

    this.observer.onSyncCompleted({
      operation: "rebuild",
      documentCount: report.totalIndexed,
      completedAt,
    });

    return report;
  }

  private async rebuildKind(
    kind: SearchDocumentKind,
    batchSize: number,
    startedAt: Date,
  ): Promise<RebuildSearchIndexKindReport> {
    const entityIds = await this.enumerate(kind);

    let indexed = 0;
    let batches = 0;

    for (let offset = 0; offset < entityIds.length; offset += batchSize) {
      const slice = entityIds.slice(offset, offset + batchSize);
      const result = await this.batchIndex.execute({ kind, entityIds: slice });
      indexed += result.indexed;
      batches += 1;
      this.observer.onRebuildProgress({
        kind,
        batch: batches,
        indexedSoFar: indexed,
        totalCandidates: entityIds.length,
      });
    }

    // Step 3 — the stale sweep. Strictly after every write, so a document
    // written by *this* pass (indexedAt >= startedAt) is never a candidate
    // for deletion.
    const sweptStale = await this.provider.deleteByFilter({ kind, indexedBefore: startedAt.toISOString() });

    return { kind, candidates: entityIds.length, indexed, batches, sweptStale };
  }

  /**
   * Enumerates every eligible entity id of a kind, using the discovery
   * repositories' own unfiltered candidate query — the same read Module
   * 19's live search uses, so "rebuildable" and "findable" can never mean
   * two different sets.
   */
  private async enumerate(kind: SearchDocumentKind): Promise<string[]> {
    if (kind === "PROFESSIONAL") {
      const candidates = await this.professionals.searchCandidates({});
      return candidates.map((candidate) => candidate.id);
    }
    if (kind === "COMPANY") {
      const candidates = await this.companies.searchCandidates({});
      return candidates.map((candidate) => candidate.id);
    }
    return [];
  }
}
