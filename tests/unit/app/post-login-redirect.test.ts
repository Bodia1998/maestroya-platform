import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Root-cause regression coverage for the post-login redirect bug: the
 * login form previously computed its destination from a client-side
 * `getSession()` read taken immediately after `signIn()` resolved, which
 * could occasionally still observe next-auth's pre-login client-cached
 * session for one tick — sending the user to the wrong destination, or
 * bouncing them back to `/auth/login`, until a retry happened to land
 * after the client cache caught up. See post-login/page.tsx's own doc
 * comment for the full writeup.
 *
 * The fix moves the decision to a Server Component
 * (`/auth/post-login`) that reads the session authoritatively via
 * `getCurrentUser()` on a fresh request — no client-side session read
 * involved at all. These tests mock `getCurrentUser`/`next/navigation`'s
 * `redirect` (same mocking convention as
 * tests/unit/app/professional-onboarding-actions.test.ts) to verify that
 * wiring directly, complementing resolve-post-login-destination.test.ts's
 * own coverage of the pure decision function both this page and
 * `/auth/login` now share.
 */
const mockGetCurrentUser = vi.fn();
const mockRedirect = vi.fn((url: string) => {
  // next/navigation's real `redirect()` throws internally (NEXT_REDIRECT)
  // to unwind the render — mirror that so `await Page(...)` rejects the
  // same way and callers can assert on both "was redirect called" and
  // "the render function actually stopped there".
  throw new Error(`REDIRECT:${url}`);
});

vi.mock("next/navigation", () => ({
  redirect: (url: string) => mockRedirect(url),
}));

vi.mock("@/infrastructure/auth/rbac", () => ({
  getCurrentUser: () => mockGetCurrentUser(),
}));

const PostLoginPage = (await import("../../../src/app/auth/post-login/page")).default;
const LoginPage = (await import("../../../src/app/auth/login/page")).default;

describe("/auth/post-login (server-authoritative post-login redirect)", () => {
  beforeEach(() => {
    mockGetCurrentUser.mockReset();
    mockRedirect.mockReset().mockImplementation((url: string) => {
      throw new Error(`REDIRECT:${url}`);
    });
  });

  it("sends an already-PROVIDER account to the Professional Dashboard (/dashboard, not the profile-editing page)", async () => {
    mockGetCurrentUser.mockResolvedValue({
      id: "user-1",
      email: "a@b.com",
      roles: ["CUSTOMER", "PROVIDER"],
      signupIntent: null,
    });

    await expect(
      PostLoginPage({ searchParams: Promise.resolve({}) }),
    ).rejects.toThrow("REDIRECT:/dashboard");
  });

  it("sends a plain customer to the customer dashboard", async () => {
    mockGetCurrentUser.mockResolvedValue({
      id: "user-1",
      email: "a@b.com",
      roles: ["CUSTOMER"],
      signupIntent: null,
    });

    await expect(
      PostLoginPage({ searchParams: Promise.resolve({}) }),
    ).rejects.toThrow("REDIRECT:/dashboard");
  });

  it("sends a PROFESSIONAL-intent account without PROVIDER yet to onboarding", async () => {
    mockGetCurrentUser.mockResolvedValue({
      id: "user-1",
      email: "a@b.com",
      roles: ["CUSTOMER"],
      signupIntent: "PROFESSIONAL",
    });

    await expect(
      PostLoginPage({ searchParams: Promise.resolve({}) }),
    ).rejects.toThrow("REDIRECT:/dashboard/professional/onboarding");
  });

  it("honors an explicit callbackUrl over role/signupIntent (role-gated redirect precedence)", async () => {
    mockGetCurrentUser.mockResolvedValue({
      id: "user-1",
      email: "a@b.com",
      roles: ["ADMIN"],
      signupIntent: null,
    });

    await expect(
      PostLoginPage({ searchParams: Promise.resolve({ callbackUrl: "/admin" }) }),
    ).rejects.toThrow("REDIRECT:/admin");
  });

  it("honors the 'Soy profesional' login-time intent for a plain customer account", async () => {
    mockGetCurrentUser.mockResolvedValue({
      id: "user-1",
      email: "a@b.com",
      roles: ["CUSTOMER"],
      signupIntent: null,
    });

    await expect(
      PostLoginPage({ searchParams: Promise.resolve({ intent: "professional" }) }),
    ).rejects.toThrow("REDIRECT:/dashboard/professional/onboarding");
  });

  it("never grants PROVIDER or mutates the account — it only decides where to navigate", async () => {
    const session = { id: "user-1", email: "a@b.com", roles: ["CUSTOMER"], signupIntent: null };
    mockGetCurrentUser.mockResolvedValue(session);

    await expect(
      PostLoginPage({ searchParams: Promise.resolve({ intent: "professional" }) }),
    ).rejects.toThrow();

    expect(session.roles).toEqual(["CUSTOMER"]);
  });

  it("falls back to /auth/login if there is somehow no session yet (fail-safe, not expected in practice)", async () => {
    mockGetCurrentUser.mockResolvedValue(null);

    await expect(
      PostLoginPage({ searchParams: Promise.resolve({ callbackUrl: "/dashboard/professional" }) }),
    ).rejects.toThrow(`REDIRECT:/auth/login?callbackUrl=${encodeURIComponent("/dashboard/professional")}`);
  });
});

describe("/auth/login (already-authenticated visitor)", () => {
  beforeEach(() => {
    mockGetCurrentUser.mockReset();
    mockRedirect.mockReset().mockImplementation((url: string) => {
      throw new Error(`REDIRECT:${url}`);
    });
  });

  it("redirects an already signed-in PROVIDER straight to the Professional Dashboard instead of showing the login form again", async () => {
    mockGetCurrentUser.mockResolvedValue({
      id: "user-1",
      email: "a@b.com",
      roles: ["PROVIDER"],
      signupIntent: null,
    });

    await expect(
      LoginPage({ searchParams: Promise.resolve({}) }),
    ).rejects.toThrow("REDIRECT:/dashboard");
  });

  it("redirects an already signed-in customer to the customer dashboard", async () => {
    mockGetCurrentUser.mockResolvedValue({
      id: "user-1",
      email: "a@b.com",
      roles: ["CUSTOMER"],
      signupIntent: null,
    });

    await expect(
      LoginPage({ searchParams: Promise.resolve({}) }),
    ).rejects.toThrow("REDIRECT:/dashboard");
  });

  it("does not redirect (renders the form) for a signed-out visitor", async () => {
    mockGetCurrentUser.mockResolvedValue(null);

    const result = await LoginPage({ searchParams: Promise.resolve({}) });

    expect(result).toBeTruthy();
    expect(mockRedirect).not.toHaveBeenCalled();
  });
});
