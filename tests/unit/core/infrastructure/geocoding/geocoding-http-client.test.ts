import { afterEach, describe, expect, it, vi } from "vitest";

import { FetchGeocodingHttpClient } from "@/infrastructure/geocoding/geocoding-http-client";

/** Module 27 — Spain Location Services hardening. */
describe("FetchGeocodingHttpClient", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("delegates to global fetch and returns its response", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ hello: "world" }) });
    vi.stubGlobal("fetch", fetchMock);

    const client = new FetchGeocodingHttpClient();
    const response = await client.get("https://example.test/x", { headers: { "X-Test": "1" } });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://example.test/x");
    expect((init.headers as Record<string, string>)["X-Test"]).toBe("1");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    await expect(response.json()).resolves.toEqual({ hello: "world" });
  });

  it("aborts the request once the configured timeout elapses", async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = vi.fn(
        (_url: string, init?: RequestInit) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
          }),
      );
      vi.stubGlobal("fetch", fetchMock);

      const client = new FetchGeocodingHttpClient(1000);
      const pending = client.get("https://example.test/slow");
      const assertion = expect(pending).rejects.toThrow("aborted");

      await vi.advanceTimersByTimeAsync(1500);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });
});
