import "server-only";

import { env } from "@/infrastructure/config/env";

/**
 * Module 47 — CQRS Search Engine (Roadmap Module 14).
 *
 * The index's **version**, and the one place its effective name is built.
 *
 * The version is a code constant rather than an env var on purpose: it is
 * a property of the document *schema* this build writes, not of the
 * deployment. Bump it in the same commit that changes `SearchDocument`'s
 * shape or the engine settings, and the new build starts writing to a
 * brand-new, empty index while the old one keeps serving the old build —
 * so a rolling deploy never has two versions fighting over one index, and
 * a rollback is instant because the previous index was never touched.
 * (This is the same reasoning behind `CacheKeyBuilder`'s `v<N>` segment
 * in Module 46, applied at index granularity.)
 *
 * The prefix comes from `SEARCH_INDEX_PREFIX` so several environments can
 * share one engine instance safely.
 */
export const SEARCH_INDEX_VERSION = 1;

export const DEFAULT_SEARCH_INDEX_PREFIX = "maestroya";

export function buildSearchIndexName(prefix: string = env.SEARCH_INDEX_PREFIX ?? DEFAULT_SEARCH_INDEX_PREFIX): string {
  return `${prefix}_search_v${SEARCH_INDEX_VERSION}`;
}
