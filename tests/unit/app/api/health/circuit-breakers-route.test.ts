import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Module 70.1 — Pre-Stripe Security & Integration Hardening (Objectives F
 * & G): HTTP-level wiring test proving `/api/health/circuit-breakers`
 * (both `GET`, which the Module 70 audit flagged for exposing breaker
 * configuration/metrics/dependency topology, and `POST`, an
 * operator-only mutation) now requires `ADMIN`/`SUPER_ADMIN`. Same
 * mocking approach as diagnostics-route.test.ts.
 */
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

const mockResetExecute = vi.fn();
vi.mock("@/infrastructure/health/compose", () => ({
  getCircuitBreakerStatusUseCase: () => ({
    execute: () => ({ dependencies: [], circuitBreakers: [{ name: "database", state: "CLOSED" }] }),
  }),
  getResetCircuitBreakerUseCase: () => ({ execute: mockResetExecute }),
}));

const { auth } = await import("@/lib/auth");
const { GET, POST } = await import("../../../../../src/app/api/health/circuit-breakers/route");

const mockedAuth = vi.mocked(auth);

function makeGetRequest() {
  return new NextRequest("http://localhost:3000/api/health/circuit-breakers");
}

function makePostRequest(body: unknown) {
  return new NextRequest("http://localhost:3000/api/health/circuit-breakers", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

describe("/api/health/circuit-breakers", () => {
  beforeEach(() => {
    mockedAuth.mockReset();
    mockResetExecute.mockReset();
    mockResetExecute.mockReturnValue({ reset: ["database"] });
  });

  describe("GET", () => {
    it("denies an unauthenticated request (401)", async () => {
      mockedAuth.mockResolvedValue(null as never);
      const response = await GET(makeGetRequest());
      expect(response.status).toBe(401);
    });

    it("denies a non-admin role (e.g. SUPPORT)", async () => {
      mockedAuth.mockResolvedValue({
        user: { id: "u1", email: "a@b.com", roles: ["SUPPORT"], signupIntent: null },
      } as never);
      const response = await GET(makeGetRequest());
      expect(response.status).toBe(401);
    });

    it("allows ADMIN and returns breaker data", async () => {
      mockedAuth.mockResolvedValue({
        user: { id: "admin-1", email: "a@b.com", roles: ["ADMIN"], signupIntent: null },
      } as never);
      const response = await GET(makeGetRequest());
      const body = await response.json();
      expect(response.status).toBe(200);
      expect(body.circuitBreakers).toHaveLength(1);
    });
  });

  describe("POST (manual reset — a real state-mutating operator action)", () => {
    it("denies an unauthenticated reset request, and never calls the reset use case", async () => {
      mockedAuth.mockResolvedValue(null as never);

      const response = await POST(makePostRequest({ name: "database" }));

      expect(response.status).toBe(401);
      expect(mockResetExecute).not.toHaveBeenCalled();
    });

    it("denies a non-admin caller's reset request", async () => {
      mockedAuth.mockResolvedValue({
        user: { id: "u1", email: "a@b.com", roles: ["CUSTOMER"], signupIntent: null },
      } as never);

      const response = await POST(makePostRequest({ name: "database" }));

      expect(response.status).toBe(401);
      expect(mockResetExecute).not.toHaveBeenCalled();
    });

    it("allows an ADMIN caller's reset request", async () => {
      mockedAuth.mockResolvedValue({
        user: { id: "admin-1", email: "a@b.com", roles: ["ADMIN"], signupIntent: null },
      } as never);

      const response = await POST(makePostRequest({ name: "database" }));
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.reset).toEqual(["database"]);
      expect(mockResetExecute).toHaveBeenCalledWith({ name: "database" });
    });
  });
});
