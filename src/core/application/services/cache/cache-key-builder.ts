/**
 * Module 46 — Caching Layer (Roadmap Module 13).
 *
 * Centralizes the one thing every cache-key string in this codebase must
 * agree on: the prefix, the separator, and how a namespace's version
 * number is embedded — so no two call sites can silently drift into
 * incompatible key shapes (a duplicated string literal — `` `cache:${ns}:${key}` ``
 * — hand-written at three different call sites is exactly how that kind
 * of drift happens). Every key this module ever writes or reads goes
 * through this class.
 *
 * Key shape: `<prefix>:<namespace>:v<version>:<parts...>`, e.g.
 * `cache:professionals:v2:search:madrid:page-1`. The version segment is
 * what makes `CacheManager.bumpVersion()` (see `cache-manager.ts`) able
 * to invalidate an entire namespace without deleting a single key: once
 * the stored version advances, every previously-built key simply stops
 * being reachable — it's still sitting in the backend, but nothing ever
 * asks for `v2:*` again, and it expires on its own TTL like any other
 * abandoned entry (Redis) or is reclaimed lazily on next access
 * (`InMemoryCacheProvider`, matching `InMemoryCacheService`'s own
 * documented lazy-reclaim trade-off).
 */
export const DEFAULT_CACHE_KEY_PREFIX = "cache";
const SEPARATOR = ":";

export interface CacheKeyBuilderOptions {
  /** Root prefix every key starts with. Defaults to `"cache"`. */
  prefix?: string;
}

export class CacheKeyBuilder {
  private readonly prefix: string;

  constructor(options: CacheKeyBuilderOptions = {}) {
    this.prefix = options.prefix ?? DEFAULT_CACHE_KEY_PREFIX;
  }

  /** Builds a versioned key for `namespace`, joining `parts` deterministically. */
  build(namespace: string, version: number, parts: ReadonlyArray<string | number>): string {
    this.assertSegment(namespace, "namespace");
    const tail = parts.map((part) => this.sanitizeSegment(String(part)));
    return [this.prefix, this.sanitizeSegment(namespace), `v${version}`, ...tail].join(SEPARATOR);
  }

  /** The key the namespace's current version counter is stored under. */
  versionKey(namespace: string): string {
    this.assertSegment(namespace, "namespace");
    return [this.prefix, this.sanitizeSegment(namespace), "__version__"].join(SEPARATOR);
  }

  /** The `*`-glob matching every key ever built for `namespace` at `version`. */
  namespacePattern(namespace: string, version: number): string {
    this.assertSegment(namespace, "namespace");
    return [this.prefix, this.sanitizeSegment(namespace), `v${version}`, "*"].join(SEPARATOR);
  }

  /**
   * Builds a deterministic, fixed-shape key suffix from an arbitrary,
   * JSON-serializable argument (e.g. a use case's input DTO) — object key
   * order never changes the resulting key, so `{a:1,b:2}` and `{b:2,a:1}`
   * produce the exact same cache entry rather than silently missing each
   * other. Uses a stable (sorted-keys) JSON stringification followed by a
   * short non-cryptographic hash (FNV-1a) purely to bound key length —
   * this is a cache key, never a security boundary, so collision
   * resistance beyond "extremely unlikely for this cache's real key
   * space" is not a requirement.
   */
  hashArgs(value: unknown): string {
    const stable = stableStringify(value);
    return fnv1a(stable);
  }

  private sanitizeSegment(segment: string): string {
    // `SEPARATOR` inside a caller-supplied segment would silently change
    // the number of logical parts a pattern/prefix match sees — replaced,
    // never stripped, so the resulting key stays visually traceable back
    // to its input.
    return segment.replace(new RegExp(SEPARATOR, "g"), "_");
  }

  private assertSegment(segment: string, label: string): void {
    if (segment.length === 0) {
      throw new RangeError(`CacheKeyBuilder: ${label} must be a non-empty string.`);
    }
  }
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value));
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value !== null && typeof value === "object") {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = sortKeysDeep((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}

/** FNV-1a 32-bit hash, hex-encoded. Deterministic, dependency-free, fast. */
function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
