import { describe, expect, it, vi } from "vitest";

import { VerificationProviderError } from "@/domain/errors/domain-error";
import { PersonaClient } from "@/infrastructure/verification/persona-client";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("PersonaClient (Module 59)", () => {
  it("returns the parsed JSON body on a 2xx response", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { data: { id: "inq_123" } }));
    const client = new PersonaClient({ apiKey: "key", fetchImpl, sleep: async () => {} });

    const result = await client.request<{ data: { id: string } }>({ method: "GET", path: "/inquiries/inq_123" });

    expect(result.data.id).toBe("inq_123");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer key");
    expect((init.headers as Record<string, string>)["Persona-Request-Id"]).toBeTruthy();
  });

  it("retries on a 5xx response and eventually succeeds", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(503, { error: "unavailable" }))
      .mockResolvedValueOnce(jsonResponse(200, { data: { id: "inq_123" } }));
    const client = new PersonaClient({ apiKey: "key", fetchImpl, sleep: async () => {}, maxAttempts: 3 });

    const result = await client.request<{ data: { id: string } }>({ method: "GET", path: "/inquiries/inq_123" });

    expect(result.data.id).toBe("inq_123");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("does not retry on a 4xx response and throws a non-retryable error", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(400, { error: "bad request" }));
    const client = new PersonaClient({ apiKey: "key", fetchImpl, sleep: async () => {}, maxAttempts: 3 });

    await expect(client.request({ method: "GET", path: "/inquiries/x" })).rejects.toMatchObject({
      code: "VERIFICATION_PROVIDER_ERROR",
      retryable: false,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("gives up after maxAttempts on repeated 5xx responses", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(500, { error: "down" }));
    const client = new PersonaClient({ apiKey: "key", fetchImpl, sleep: async () => {}, maxAttempts: 2 });

    await expect(client.request({ method: "GET", path: "/inquiries/x" })).rejects.toBeInstanceOf(VerificationProviderError);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("wraps a network error as a retryable VerificationProviderError", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    const client = new PersonaClient({ apiKey: "key", fetchImpl, sleep: async () => {}, maxAttempts: 2 });

    await expect(client.request({ method: "GET", path: "/inquiries/x" })).rejects.toMatchObject({
      code: "VERIFICATION_PROVIDER_ERROR",
      retryable: true,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
