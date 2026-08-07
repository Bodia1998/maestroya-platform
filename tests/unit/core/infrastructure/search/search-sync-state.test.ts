import { describe, expect, it } from "vitest";

import { getSearchSyncState } from "@/infrastructure/search/search-sync-state";

describe("infrastructure/search/search-sync-state", () => {
  it("getSearchSyncState() returns the same process-wide instance", () => {
    expect(getSearchSyncState()).toBe(getSearchSyncState());
  });

  it("recordSync updates lastSuccessfulSyncAt/lastOperation/lastDocumentCount and increments totalSyncs", () => {
    const state = getSearchSyncState();
    state.reset();
    const at = new Date("2026-01-01T00:00:00.000Z");

    state.recordSync("index", 3, at);

    const snapshot = state.snapshot();
    expect(snapshot.lastSuccessfulSyncAt).toEqual(at);
    expect(snapshot.lastOperation).toBe("index");
    expect(snapshot.lastDocumentCount).toBe(3);
    expect(snapshot.totalSyncs).toBe(1);
  });

  it("recordFailure increments totalFailures and captures the error message", () => {
    const state = getSearchSyncState();
    state.reset();

    state.recordFailure(new Error("engine down"));

    const snapshot = state.snapshot();
    expect(snapshot.totalFailures).toBe(1);
    expect(snapshot.lastFailureMessage).toBe("engine down");
    expect(snapshot.lastFailureAt).toBeInstanceOf(Date);
  });

  it("reset() clears every field back to its initial state", () => {
    const state = getSearchSyncState();
    state.recordSync("index", 1, new Date());
    state.recordFailure(new Error("boom"));

    state.reset();

    expect(state.snapshot()).toEqual({
      lastSuccessfulSyncAt: null,
      lastOperation: null,
      lastDocumentCount: 0,
      totalSyncs: 0,
      totalFailures: 0,
      lastFailureAt: null,
      lastFailureMessage: null,
    });
  });
});
