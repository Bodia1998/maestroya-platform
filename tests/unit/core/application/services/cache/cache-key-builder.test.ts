import { describe, expect, it } from "vitest";

import { CacheKeyBuilder, DEFAULT_CACHE_KEY_PREFIX } from "@/application/services/cache/cache-key-builder";

describe("application/services/cache/cache-key-builder", () => {
  it("builds a deterministic, versioned key with the default prefix", () => {
    const keys = new CacheKeyBuilder();
    expect(keys.build("professionals", 1, ["search", "madrid"])).toBe(
      `${DEFAULT_CACHE_KEY_PREFIX}:professionals:v1:search:madrid`,
    );
  });

  it("uses a custom prefix when supplied", () => {
    const keys = new CacheKeyBuilder({ prefix: "myapp" });
    expect(keys.build("users", 2, ["1"])).toBe("myapp:users:v2:1");
  });

  it("the same namespace/version/parts always produce the same key", () => {
    const keys = new CacheKeyBuilder();
    expect(keys.build("ns", 3, ["a", 1, "b"])).toBe(keys.build("ns", 3, ["a", 1, "b"]));
  });

  it("a different version produces a different key", () => {
    const keys = new CacheKeyBuilder();
    expect(keys.build("ns", 1, ["a"])).not.toBe(keys.build("ns", 2, ["a"]));
  });

  it("sanitizes a separator character inside a segment rather than splitting it", () => {
    const keys = new CacheKeyBuilder();
    expect(keys.build("ns", 1, ["a:b"])).toBe(`${DEFAULT_CACHE_KEY_PREFIX}:ns:v1:a_b`);
  });

  it("rejects an empty namespace", () => {
    const keys = new CacheKeyBuilder();
    expect(() => keys.build("", 1, ["a"])).toThrow(RangeError);
  });

  it("versionKey() is stable and distinct from any built key", () => {
    const keys = new CacheKeyBuilder();
    expect(keys.versionKey("professionals")).toBe(`${DEFAULT_CACHE_KEY_PREFIX}:professionals:__version__`);
  });

  it("namespacePattern() produces a glob matching every key at that version", () => {
    const keys = new CacheKeyBuilder();
    expect(keys.namespacePattern("professionals", 2)).toBe(`${DEFAULT_CACHE_KEY_PREFIX}:professionals:v2:*`);
  });

  describe("hashArgs", () => {
    it("is deterministic for the same value", () => {
      const keys = new CacheKeyBuilder();
      expect(keys.hashArgs({ city: "Madrid", page: 1 })).toBe(keys.hashArgs({ city: "Madrid", page: 1 }));
    });

    it("is independent of object key order", () => {
      const keys = new CacheKeyBuilder();
      expect(keys.hashArgs({ a: 1, b: 2 })).toBe(keys.hashArgs({ b: 2, a: 1 }));
    });

    it("produces different hashes for different values", () => {
      const keys = new CacheKeyBuilder();
      expect(keys.hashArgs({ a: 1 })).not.toBe(keys.hashArgs({ a: 2 }));
    });

    it("handles nested arrays/objects deterministically", () => {
      const keys = new CacheKeyBuilder();
      const value = { filters: [{ z: 1, a: 2 }], sort: "asc" };
      const same = { sort: "asc", filters: [{ a: 2, z: 1 }] };
      expect(keys.hashArgs(value)).toBe(keys.hashArgs(same));
    });
  });
});
