import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

/**
 * `middleware.ts`'s default export is `auth((req) => {...})` — Auth.js's
 * own higher-order wrapper that resolves the session from the incoming
 * request and attaches it as `req.auth` before invoking the callback. This
 * mock reproduces exactly that shape (attach a test-supplied session, then
 * call through) so the real routing/redirect logic in middleware.ts runs
 * unmodified — only session resolution itself is faked, the same "mock
 * one collaborator, exercise the real logic" approach every other test in
 * this suite uses (see rbac.test.ts mocking the same module).
 */
interface FakeSession {
  user: { id: string; roles: string[]; signupIntent: string | null };
}

let mockSession: FakeSession | null = null;

vi.mock("@/lib/auth", () => ({
  auth:
    (handler: (req: NextRequest & { auth: FakeSession | null }) => unknown) =>
    (req: NextRequest) => {
      (req as NextRequest & { auth: FakeSession | null }).auth = mockSession;
      return handler(req as NextRequest & { auth: FakeSession | null });
    },
}));

const { default: middlewareHandler } = await import("../../middleware");

function makeRequest(path: string) {
  return new NextRequest(`http://localhost:3000${path}`);
}

/**
 * The real signature is `(req: NextRequest, event: NextFetchEvent) =>
 * void | Response | Promise<void | Response>` — middleware.ts's own
 * callback never returns `void`, but the wrapping `auth()` type is wider
 * than what this codebase's implementation actually does. The second
 * argument is never read by middleware.ts, so an empty stand-in is fine;
 * the cast narrows the return back to the `Response` every test here
 * asserts against.
 */
async function middleware(req: NextRequest): Promise<Response> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return middlewareHandler(req, {} as any) as Promise<Response>;
}

describe("middleware.ts", () => {
  describe("Professional Onboarding redirect", () => {
    it("redirects a PROFESSIONAL-intent user without the PROVIDER role away from the Customer Dashboard", async () => {
      mockSession = { user: { id: "u1", roles: ["CUSTOMER"], signupIntent: "PROFESSIONAL" } };

      const response = await middleware(makeRequest("/dashboard"));

      expect(response.status).toBe(307);
      expect(response.headers.get("location")).toBe(
        "http://localhost:3000/dashboard/professional/onboarding",
      );
    });

    it("does not redirect a customer (no signupIntent) away from the Customer Dashboard", async () => {
      mockSession = { user: { id: "u1", roles: ["CUSTOMER"], signupIntent: null } };

      const response = await middleware(makeRequest("/dashboard"));

      expect(response.status).toBe(200);
    });

    it("does not redirect a PROFESSIONAL-intent user who already has the PROVIDER role", async () => {
      mockSession = {
        user: { id: "u1", roles: ["CUSTOMER", "PROVIDER"], signupIntent: "PROFESSIONAL" },
      };

      const response = await middleware(makeRequest("/dashboard"));

      expect(response.status).toBe(200);
    });

    it("lets a PROFESSIONAL-intent user without PROVIDER reach the onboarding page itself (no redirect loop)", async () => {
      mockSession = { user: { id: "u1", roles: ["CUSTOMER"], signupIntent: "PROFESSIONAL" } };

      const response = await middleware(makeRequest("/dashboard/professional/onboarding"));

      expect(response.status).toBe(200);
    });

    it("also redirects from other nested /dashboard routes, not just the top-level one", async () => {
      mockSession = { user: { id: "u1", roles: ["CUSTOMER"], signupIntent: "PROFESSIONAL" } };

      const response = await middleware(makeRequest("/dashboard/professional/quotes"));

      expect(response.status).toBe(307);
      expect(response.headers.get("location")).toBe(
        "http://localhost:3000/dashboard/professional/onboarding",
      );
    });

    it("does not apply the onboarding redirect to an unauthenticated request (that's the login redirect's job)", async () => {
      mockSession = null;

      const response = await middleware(makeRequest("/dashboard"));

      expect(response.status).toBe(307);
      expect(response.headers.get("location")).toBe(
        "http://localhost:3000/auth/login?callbackUrl=%2Fdashboard",
      );
    });
  });

  describe("existing protected-route behavior (regression)", () => {
    it("redirects an unauthenticated user hitting /dashboard to login with a callbackUrl", async () => {
      mockSession = null;

      const response = await middleware(makeRequest("/dashboard"));

      expect(response.status).toBe(307);
      expect(response.headers.get("location")).toBe(
        "http://localhost:3000/auth/login?callbackUrl=%2Fdashboard",
      );
    });

    it("lets a signed-in customer through to /dashboard", async () => {
      mockSession = { user: { id: "u1", roles: ["CUSTOMER"], signupIntent: null } };

      const response = await middleware(makeRequest("/dashboard"));

      expect(response.status).toBe(200);
    });

    it("never touches a public route regardless of auth state", async () => {
      mockSession = null;

      const response = await middleware(makeRequest("/"));

      expect(response.status).toBe(200);
    });
  });

  describe("protected non-/dashboard routes (root-cause regression: (dashboard) route group pages have URLs outside /dashboard)", () => {
    // Root cause: /requests, /appointments, /jobs, /messages, /disputes,
    // /support-tickets, and /profile are each their own top-level page.tsx
    // under the (dashboard) route group (route groups add no URL segment)
    // and every one of them already calls requireAuth() itself — but only
    // "/dashboard" was ever listed in PROTECTED_PREFIXES, so an anonymous
    // visitor hitting any of these directly (e.g. the "Request this
    // service" link now on a public professional profile) got an
    // unhandled thrown error instead of the expected login redirect. See
    // PROTECTED_PREFIXES's own doc comment for the full writeup.
    it.each([
      "/requests",
      "/requests/new",
      "/appointments",
      "/jobs",
      "/messages",
      "/disputes",
      "/support-tickets",
      "/profile",
    ])("redirects an unauthenticated user hitting %s to login with a matching callbackUrl", async (path) => {
      mockSession = null;

      const response = await middleware(makeRequest(path));

      expect(response.status).toBe(307);
      expect(response.headers.get("location")).toBe(
        `http://localhost:3000/auth/login?callbackUrl=${encodeURIComponent(path)}`,
      );
    });

    it.each(["/requests", "/appointments", "/jobs", "/messages", "/disputes", "/support-tickets", "/profile"])(
      "lets a signed-in customer through to %s",
      async (path) => {
        mockSession = { user: { id: "u1", roles: ["CUSTOMER"], signupIntent: null } };

        const response = await middleware(makeRequest(path));

        expect(response.status).toBe(200);
      },
    );

    it("never touches the public professional search/profile routes regardless of auth state", async () => {
      mockSession = null;

      const response = await middleware(makeRequest("/professionals/some-id"));

      expect(response.status).toBe(200);
    });

    it("preserves query params (e.g. the 'Request this service' prefill hints) across the login redirect", async () => {
      mockSession = null;

      const response = await middleware(makeRequest("/requests/new?categoryId=abc-123&city=Gandia"));

      expect(response.status).toBe(307);
      expect(response.headers.get("location")).toBe(
        `http://localhost:3000/auth/login?callbackUrl=${encodeURIComponent("/requests/new?categoryId=abc-123&city=Gandia")}`,
      );
    });
  });

  describe("existing role-gated /admin behavior (regression)", () => {
    it("redirects an unauthenticated user to login with callbackUrl=/admin", async () => {
      mockSession = null;

      const response = await middleware(makeRequest("/admin"));

      expect(response.status).toBe(307);
      expect(response.headers.get("location")).toBe(
        "http://localhost:3000/auth/login?callbackUrl=%2Fadmin",
      );
    });

    it("redirects a signed-in user lacking ADMIN/SUPER_ADMIN back to the homepage", async () => {
      mockSession = { user: { id: "u1", roles: ["CUSTOMER"], signupIntent: null } };

      const response = await middleware(makeRequest("/admin"));

      expect(response.status).toBe(307);
      expect(response.headers.get("location")).toBe("http://localhost:3000/");
    });

    it("lets a signed-in ADMIN through to /admin", async () => {
      mockSession = { user: { id: "u1", roles: ["ADMIN"], signupIntent: null } };

      const response = await middleware(makeRequest("/admin"));

      expect(response.status).toBe(200);
    });

    it("is unaffected by signupIntent — a PROFESSIONAL-intent admin still gets the admin role gate, not the onboarding redirect", async () => {
      mockSession = { user: { id: "u1", roles: ["ADMIN"], signupIntent: "PROFESSIONAL" } };

      const response = await middleware(makeRequest("/admin"));

      expect(response.status).toBe(200);
    });
  });
});
