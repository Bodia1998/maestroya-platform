import { beforeEach, describe, expect, it, vi } from "vitest";

import type * as RbacModule from "@/infrastructure/auth/rbac";

/**
 * Admin Panel module (Module 16): regression coverage for the independent,
 * page-level authorization boundary in `admin/layout.tsx`.
 *
 * Context: a prior read-only platform audit initially flagged this boundary
 * as missing, reasoning that every `/admin/*` route relied solely on
 * `middleware.ts`'s role gate. That conclusion turned out to be a false
 * positive caused by a failed directory lookup during the audit (the
 * Next.js route-group folder name `(dashboard)` was not matched by the
 * glob pattern used to search for `admin/layout.tsx`) — the layout has, in
 * fact, called `getCurrentUser()` and independently redirected non-admins
 * since Module 16 was first built (see git history for
 * `src/app/(dashboard)/admin/layout.tsx`). No production code changed as a
 * result of the remediation task that produced this test; it exists purely
 * to lock in the already-correct behavior so a future refactor can't
 * silently remove this second layer without a test failing.
 *
 * Mocking convention matches `tests/unit/app/post-login-redirect.test.ts`:
 * `next/navigation`'s `redirect()` throws in the real implementation to
 * unwind rendering, so the mock does the same, letting these tests assert
 * both "redirect was called" and "with the right destination" by awaiting
 * a rejected promise.
 */
const mockGetCurrentUser = vi.fn();
const mockRedirect = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});

vi.mock("next/navigation", () => ({
  redirect: (url: string) => mockRedirect(url),
}));

vi.mock("@/infrastructure/auth/rbac", async () => {
  const actual = await vi.importActual<typeof RbacModule>("@/infrastructure/auth/rbac");
  return {
    ...actual,
    getCurrentUser: () => mockGetCurrentUser(),
  };
});

const AdminLayout = (await import("../../../src/app/(dashboard)/admin/layout")).default;

async function renderLayout() {
  return AdminLayout({ children: null });
}

describe("/admin layout (independent, page-level authorization boundary)", () => {
  beforeEach(() => {
    mockGetCurrentUser.mockReset();
    mockRedirect.mockReset().mockImplementation((url: string) => {
      throw new Error(`REDIRECT:${url}`);
    });
  });

  it("redirects an unauthenticated visitor to login with a callback back to /admin", async () => {
    mockGetCurrentUser.mockResolvedValue(null);

    await expect(renderLayout()).rejects.toThrow("REDIRECT:/auth/login?callbackUrl=/admin");
  });

  it("redirects a CUSTOMER away from the admin area", async () => {
    mockGetCurrentUser.mockResolvedValue({
      id: "user-1",
      email: "customer@example.com",
      roles: ["CUSTOMER"],
      signupIntent: null,
    });

    await expect(renderLayout()).rejects.toThrow("REDIRECT:/");
  });

  it("redirects a PROVIDER (professional) away from the admin area", async () => {
    mockGetCurrentUser.mockResolvedValue({
      id: "user-2",
      email: "pro@example.com",
      roles: ["PROVIDER"],
      signupIntent: null,
    });

    await expect(renderLayout()).rejects.toThrow("REDIRECT:/");
  });

  it("redirects a user holding both CUSTOMER and PROVIDER roles (e.g. a company member) but no ADMIN role", async () => {
    mockGetCurrentUser.mockResolvedValue({
      id: "user-3",
      email: "company-member@example.com",
      roles: ["CUSTOMER", "PROVIDER"],
      signupIntent: null,
    });

    await expect(renderLayout()).rejects.toThrow("REDIRECT:/");
  });

  it("allows an ADMIN through without redirecting", async () => {
    mockGetCurrentUser.mockResolvedValue({
      id: "admin-1",
      email: "admin@example.com",
      roles: ["ADMIN"],
      signupIntent: null,
    });

    const result = await renderLayout();

    expect(result).toBeTruthy();
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it("allows a SUPER_ADMIN through without redirecting", async () => {
    mockGetCurrentUser.mockResolvedValue({
      id: "super-1",
      email: "super@example.com",
      roles: ["SUPER_ADMIN"],
      signupIntent: null,
    });

    const result = await renderLayout();

    expect(result).toBeTruthy();
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it("this independent check does not depend on middleware having already run — it re-derives the session itself", async () => {
    // No middleware/request context is mocked or referenced anywhere in
    // this test file — `getCurrentUser()` is the layout's only source of
    // truth, exactly as it would be if middleware.ts's own role gate were
    // ever bypassed, removed, or misconfigured for this route.
    mockGetCurrentUser.mockResolvedValue({
      id: "user-4",
      email: "attacker@example.com",
      roles: [],
      signupIntent: null,
    });

    await expect(renderLayout()).rejects.toThrow("REDIRECT:/");
  });
});
