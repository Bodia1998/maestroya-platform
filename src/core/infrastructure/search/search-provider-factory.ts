import "server-only";

// The SDK's client class is named `Meilisearch` (lower-case "s") from
// v0.55 onwards — the older `MeiliSearch` spelling was dropped.
import { Meilisearch } from "meilisearch";
import { Client as TypesenseClient } from "typesense";

import type { SearchIndexProvider } from "@/application/ports/search-index-provider";
import { env } from "@/infrastructure/config/env";
import { logger } from "@/infrastructure/observability/logger";
import { buildSearchIndexName } from "@/infrastructure/search/search-index-name";
import { InMemorySearchProvider } from "@/infrastructure/search/providers/in-memory-search-provider";
import {
  MeilisearchSearchProvider,
  type MeilisearchClientApi,
} from "@/infrastructure/search/providers/meilisearch-search-provider";
import {
  TypesenseSearchProvider,
  type TypesenseClientApi,
} from "@/infrastructure/search/providers/typesense-search-provider";
import { getTracer } from "@/infrastructure/tracing/compose";
import { withSearchTracing } from "@/infrastructure/tracing/traced-search-provider";

/**
 * Module 47 — CQRS Search Engine (Roadmap Module 14).
 *
 * The single place that decides which `SearchIndexProvider` a process
 * gets — the same factory-function shape as
 * `cache-provider-factory.ts`, `job-store-factory.ts`, and
 * `geocoding-provider-factory.ts`: one memoized instance per process,
 * chosen from the validated env, with a `__testing.reset()` so a test can
 * force the decision to be re-made.
 *
 * Memoization is not just an optimization here. The in-memory provider
 * *is* the index in that mode — two instances would mean the worker
 * indexing into one store while the read side queries an empty other
 * one. For the network-backed providers it additionally avoids opening a
 * second HTTP client per call site.
 *
 * ## Fallback, never failure
 * A selected engine whose host is not configured falls back to the
 * in-memory provider with a warning rather than throwing. This is the
 * same rule `geocoding-provider-factory.ts` follows, and it exists so a
 * half-configured environment degrades to working local search instead of
 * failing to boot — a search index is derived data, and no deployment
 * should ever be blocked by it.
 */
let instance: SearchIndexProvider | null = null;

export function createSearchProvider(): SearchIndexProvider {
  // Module 51 — Distributed Tracing: a decorator over the same
  // `SearchIndexProvider` port, returned untouched when tracing is
  // disabled. Wrapping here rather than in each of the three providers
  // means the in-memory, Meilisearch and Typesense paths are all
  // instrumented by one file, and the read/indexing use cases above stay
  // unaware — the same reason the provider choice itself lives here.
  if (!instance) instance = withSearchTracing(buildProvider(), getTracer());
  return instance;
}

function buildProvider(): SearchIndexProvider {
  const indexName = buildSearchIndexName();

  switch (env.SEARCH_PROVIDER) {
    case "meilisearch": {
      if (!env.MEILISEARCH_HOST) {
        logger.warn("search_provider_misconfigured", {
          provider: "meilisearch",
          reason: "MEILISEARCH_HOST is not set — falling back to the in-memory search provider.",
        });
        return new InMemorySearchProvider();
      }
      // The SDK client is constructed here and nowhere else. The cast is
      // to this codebase's own narrow structural interface (the five calls
      // the provider makes), not away from type safety: it keeps the
      // provider unit-testable against a fake and insulates it from SDK
      // type churn. See `MeilisearchSearchProvider`'s doc comment.
      const client = new Meilisearch({
        host: env.MEILISEARCH_HOST,
        apiKey: env.MEILISEARCH_API_KEY,
      }) as unknown as MeilisearchClientApi;
      return new MeilisearchSearchProvider(client, indexName);
    }

    case "typesense": {
      if (!env.TYPESENSE_HOST) {
        logger.warn("search_provider_misconfigured", {
          provider: "typesense",
          reason: "TYPESENSE_HOST is not set — falling back to the in-memory search provider.",
        });
        return new InMemorySearchProvider();
      }
      const url = new URL(env.TYPESENSE_HOST);
      const client = new TypesenseClient({
        nodes: [
          {
            host: url.hostname,
            port: Number(url.port) || (url.protocol === "https:" ? 443 : 80),
            protocol: url.protocol.replace(":", ""),
          },
        ],
        apiKey: env.TYPESENSE_API_KEY ?? "",
        connectionTimeoutSeconds: 5,
      }) as unknown as TypesenseClientApi;
      return new TypesenseSearchProvider(client, indexName);
    }

    default:
      return new InMemorySearchProvider();
  }
}

/** Exposed for tests only — forces the next call to re-decide. */
export const __testing = {
  reset(): void {
    instance = null;
  },
};
