import "server-only";

import type { SearchDocument, SearchDocumentKind } from "@/domain/entities/search-document";
import type {
  SearchIndexFilter,
  SearchIndexProvider,
  SearchIndexQuery,
  SearchIndexQueryResult,
  SearchProviderStatus,
} from "@/application/ports/search-index-provider";
import type { TracingPort } from "@/application/ports/tracing";

/**
 * Module 51 — Distributed Tracing — the search engine.
 *
 * A decorator implementing the *unmodified* `SearchIndexProvider` port
 * (Module 47), wired in `search-provider-factory.ts` — the single place
 * that already decides between Meilisearch, Typesense and the in-memory
 * provider. Neither the read side (`SearchReadModelUseCase`), the
 * indexing use cases, nor any of the three provider implementations
 * change.
 *
 * `ping()` is deliberately **not** traced: it is called by
 * `/api/health/ready` on every readiness probe (which a load balancer
 * runs every few seconds, forever), and a health check that generates a
 * steady stream of spans is pure noise that would also keep an otherwise
 * idle exporter permanently busy. The same reasoning applies to why the
 * health route itself reports rather than measures.
 */
export class TracedSearchIndexProvider implements SearchIndexProvider {
  constructor(
    private readonly delegate: SearchIndexProvider,
    private readonly tracer: TracingPort,
  ) {}

  get name(): string {
    return this.delegate.name;
  }

  async indexDocument(document: SearchDocument): Promise<void> {
    return this.tracer.withSpan(
      "search.index_document",
      () => this.delegate.indexDocument(document),
      this.spanOptions({ "search.document.kind": document.kind }),
    );
  }

  async indexDocuments(documents: SearchDocument[]): Promise<void> {
    return this.tracer.withSpan(
      "search.index_documents",
      () => this.delegate.indexDocuments(documents),
      this.spanOptions({ "search.batch_size": documents.length }),
    );
  }

  async deleteDocument(documentId: string): Promise<void> {
    return this.tracer.withSpan(
      "search.delete_document",
      () => this.delegate.deleteDocument(documentId),
      this.spanOptions(),
    );
  }

  async deleteByFilter(filter: SearchIndexFilter): Promise<number> {
    return this.tracer.withSpan(
      "search.delete_by_filter",
      async (span) => {
        const removed = await this.delegate.deleteByFilter(filter);
        span.setAttribute("search.deleted_documents", removed);
        return removed;
      },
      this.spanOptions({ "search.filter.kind": filter.kind }),
    );
  }

  async search(query: SearchIndexQuery): Promise<SearchIndexQueryResult> {
    return this.tracer.withSpan(
      "search.query",
      async (span) => {
        const result = await this.delegate.search(query);
        span.setAttributes({
          "search.total_hits": result.total,
          "search.returned_hits": result.hits.length,
          "search.engine_took_ms": result.tookMs,
        });
        return result;
      },
      // The *shape* of the query, never the customer's search text —
      // free-text queries are user-entered content and belong no more in
      // an exported span than in a log line.
      this.spanOptions({
        "search.has_text": Boolean(query.text),
        "search.kinds": query.kinds?.join(",") ?? "all",
        "search.sort": query.sort ?? "RELEVANCE",
        "search.page": query.page,
        "search.page_size": query.pageSize,
      }),
    );
  }

  async countDocuments(kind?: SearchDocumentKind): Promise<number> {
    return this.tracer.withSpan(
      "search.count_documents",
      () => this.delegate.countDocuments(kind),
      this.spanOptions({ "search.document.kind": kind }),
    );
  }

  /** Untraced by design — see this class's doc comment. */
  async ping(): Promise<SearchProviderStatus> {
    return this.delegate.ping();
  }

  private spanOptions(extra?: Record<string, string | number | boolean | undefined>) {
    return {
      kind: "client" as const,
      attributes: { "external.system": `search:${this.delegate.name}`, ...extra },
    };
  }
}

/** Wraps only when tracing is on — otherwise the provider is untouched. */
export function withSearchTracing(provider: SearchIndexProvider, tracer: TracingPort): SearchIndexProvider {
  return tracer.enabled ? new TracedSearchIndexProvider(provider, tracer) : provider;
}
