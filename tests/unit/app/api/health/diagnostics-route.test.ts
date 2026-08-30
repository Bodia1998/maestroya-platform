import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Module 70.1 — Pre-Stripe Security & Integration Hardening (Objectives F
 * & G): HTTP-level wiring test proving `/api/health/diagnostics` — flagged
 * by the Module 70 audit for exposing internal topology/dependency
 * information to any unauthenticated caller — is now gated by the same
 * `requireRole(ADMIN, SUPER_ADMIN)` seam `/api/analytics/dashboard`
 * already uses. Mocks `@/lib/auth`'s `auth()`, the one collaborator
 * `rbac.ts`'s own test suite (rbac.test.ts) already establishes as the
 * correct mock point, so `requireRole`'s real authorization logic runs
 * unmodified.
 */
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

// Module 82 — Admin RBAC & Production Auth Hardening: requireRole() now
// re-verifies status/roles fresh from the DB for admin-tier checks (see
// rbac.ts's own doc comment) — mocked the same "mock one collaborator"
// way as tests/unit/core/infrastructure/auth/rbac.test.ts.
const { mockUsers } = vi.hoisted(() => ({
  mockUsers: {
    findById: vi.fn(),
    getRoleKeys: vi.fn(),
  },
}));

vi.mock("@/infrastructure/database/prisma/repositories/prisma-user-repository", () => ({
  PrismaUserRepository: vi.fn().mockImplementation(() => mockUsers),
}));
vi.mock("@/infrastructure/health/compose", () => ({
  getPlatformHealthUseCase: () => ({
    execute: async () => ({ status: "HEALTHY", timestamp: new Date().toISOString(), checks: {} }),
  }),
  getCircuitBreakerStatusUseCase: () => ({
    execute: () => ({ dependencies: [], circuitBreakers: [] }),
  }),
}));

const { auth } = await import("@/lib/auth");
const { GET } = await import("../../../../../src/app/api/health/diagnostics/route");

const mockedAuth = vi.mocked(auth);

function makeRequest() {
  return new NextRequest("http://localhost:3000/api/health/diagnostics");
}

describe("GET /api/health/diagnostics", () => {
  beforeEach(() => {
    mockedAuth.mockReset();
    mockUsers.findById.mockReset();
    mockUsers.getRoleKeys.mockReset();
    mockUsers.findById.mockResolvedValue({ id: "admin-1", status: "ACTIVE" });
    mockUsers.getRoleKeys.mockResolvedValue(["ADMIN", "SUPER_ADMIN"]);
  });

  it("denies an unauthenticated request (401), before any health check ever runs", async () => {
    mockedAuth.mockResolvedValue(null as never);

    const response = await GET(makeRequest());

    expect(response.status).toBe(401);
  });

  it("denies a signed-in caller without ADMIN/SUPER_ADMIN (e.g. a CUSTOMER)", async () => {
    mockedAuth.mockResolvedValue({
      user: { id: "u1", email: "a@b.com", roles: ["CUSTOMER"], signupIntent: null },
    } as never);

    const response = await GET(makeRequest());

    expect(response.status).toBe(401);
  });

  it("allows an ADMIN caller and returns platform health data", async () => {
    mockedAuth.mockResolvedValue({
      user: { id: "admin-1", email: "a@b.com", roles: ["ADMIN"], signupIntent: null },
    } as never);

    const response = await GET(makeRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe("HEALTHY");
  });

  it("allows a SUPER_ADMIN caller", async () => {
    mockedAuth.mockResolvedValue({
      user: { id: "sa-1", email: "a@b.com", roles: ["SUPER_ADMIN"], signupIntent: null },
    } as never);

    const response = await GET(makeRequest());
    expect(response.status).toBe(200);
  });
});
