import { describe, expect, it } from "vitest";

import { buildSearchIndexName, DEFAULT_SEARCH_INDEX_PREFIX, SEARCH_INDEX_VERSION } from "@/infrastructure/search/search-index-name";

describe("infrastructure/search/search-index-name", () => {
  it("builds the index name from a prefix and the version constant", () => {
    expect(buildSearchIndexName("acme")).toBe(`acme_search_v${SEARCH_INDEX_VERSION}`);
  });

  it("defaults to DEFAULT_SEARCH_INDEX_PREFIX when no prefix is given and env has none configured", () => {
    expect(buildSearchIndexName(DEFAULT_SEARCH_INDEX_PREFIX)).toBe(`maestroya_search_v${SEARCH_INDEX_VERSION}`);
  });
});
