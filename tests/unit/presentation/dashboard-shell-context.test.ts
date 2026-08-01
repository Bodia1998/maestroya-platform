import { describe, expect, it } from "vitest";

import { resolveVisibleNavGroups } from "@/components/dashboard/dashboard-shell";
import { buildDashboardNavGroups } from "@/shared/utils/build-dashboard-nav-groups";

/**
 * Root-cause regression coverage: "professional dashboard shows customer
 * dashboard navigation/content" — the sidebar previously rendered every
 * nav group a dual-role account was entitled to at once, regardless of
 * which context the current page actually belonged to. See
 * dashboard-shell.tsx's own doc comment on `resolveVisibleNavGroups` for
 * the full root-cause writeup and the context-precedence rules these
 * tests pin down.
 */
describe("resolveVisibleNavGroups", () => {
  const customerOnlyGroups = buildDashboardNavGroups({ isProfessional: false, isAdmin: false });
  const dualRoleGroups = buildDashboardNavGroups({ isProfessional: true, isAdmin: false });

  it("shows only the customer group for a customer-only account, on every page", () => {
    for (const pathname of ["/dashboard", "/requests", "/appointments", "/profile"]) {
      const visible = resolveVisibleNavGroups(customerOnlyGroups, pathname);
      expect(visible.some((g) => g.title === "Professional")).toBe(false);
      expect(visible.some((g) => g.context === "customer")).toBe(true);
    }
  });

  it("never shows the customer group's full link list while on a /dashboard/professional/* page", () => {
    for (const pathname of [
      "/dashboard/professional",
      "/dashboard/professional/requests",
      "/dashboard/professional/quotes",
      "/dashboard/professional/appointments/123",
    ]) {
      const visible = resolveVisibleNavGroups(dualRoleGroups, pathname);
      expect(visible.some((g) => g.context === "customer")).toBe(false);
      expect(visible.some((g) => g.title === "Professional")).toBe(true);
    }
  });

  it("defaults a dual-role account to the Professional group on the shared /dashboard overview — never the customer dashboard as the default view", () => {
    const visible = resolveVisibleNavGroups(dualRoleGroups, "/dashboard");

    expect(visible.some((g) => g.context === "customer")).toBe(false);
    expect(visible.some((g) => g.title === "Professional")).toBe(true);
  });

  it("shows the customer group on unambiguously customer-side routes even for a dual-role account, with a link back to Professional", () => {
    for (const pathname of ["/requests", "/appointments/123", "/jobs"]) {
      const visible = resolveVisibleNavGroups(dualRoleGroups, pathname);
      expect(visible.some((g) => g.context === "professional")).toBe(false);
      expect(visible.some((g) => g.context === "customer")).toBe(true);
      expect(
        visible.some((g) => g.items.some((item) => item.href === "/dashboard/professional")),
      ).toBe(true);
    }
  });

  it("keeps a dual-role account in the Professional context on the shared Messages/Disputes/Support modules — never switches the nav back to the customer dashboard", () => {
    for (const pathname of ["/messages", "/disputes", "/support-tickets"]) {
      const visible = resolveVisibleNavGroups(dualRoleGroups, pathname);
      expect(visible.some((g) => g.context === "customer")).toBe(false);
      expect(visible.some((g) => g.title === "Professional")).toBe(true);
    }
  });

  it("adds a single switch-to-Professional link (not the full group) when showing the customer context to a dual-role account", () => {
    const visible = resolveVisibleNavGroups(dualRoleGroups, "/requests");
    const switchGroup = visible.find(
      (g) => !g.context && g.items.some((item) => item.href === "/dashboard/professional"),
    );

    expect(switchGroup?.items).toHaveLength(1);
  });

  it("never adds a switch-to-Customer link while in the professional context — the professional dashboard must contain no customer navigation", () => {
    for (const pathname of ["/dashboard/professional/requests", "/messages", "/disputes", "/support-tickets"]) {
      const visible = resolveVisibleNavGroups(dualRoleGroups, pathname);
      expect(visible.some((g) => g.items.some((item) => item.href === "/requests"))).toBe(false);
      expect(
        visible.some((g) => g.items.some((item) => item.label.toLowerCase().includes("customer"))),
      ).toBe(false);
    }
  });

  it("never adds a switch link for a customer-only account (nothing to switch to)", () => {
    const visible = resolveVisibleNavGroups(customerOnlyGroups, "/requests");

    expect(visible.some((g) => g.items.some((item) => item.href === "/dashboard/professional"))).toBe(false);
  });

  it("always keeps the context-less Profile group visible regardless of active context", () => {
    const inCustomerContext = resolveVisibleNavGroups(dualRoleGroups, "/requests");
    const inProfessionalContext = resolveVisibleNavGroups(dualRoleGroups, "/dashboard/professional");

    expect(inCustomerContext.some((g) => g.items.some((item) => item.href === "/profile"))).toBe(true);
    expect(inProfessionalContext.some((g) => g.items.length === 1)).toBe(true);
  });

  /**
   * Root-cause regression: "the bottom sidebar Profile button opens the
   * CUSTOMER profile even while working the Professional dashboard." The
   * context-less Profile group's single item must point at the
   * professional's own profile — never `/profile` — for the entire time
   * the Professional context is active, on every route that resolves to
   * it (not just `/dashboard/professional` itself).
   */
  it("swaps the bottom Profile link for 'Professional Profile' -> /dashboard/professional while the Professional context is active", () => {
    for (const pathname of ["/dashboard/professional", "/dashboard/professional/requests", "/messages", "/disputes", "/support-tickets"]) {
      const visible = resolveVisibleNavGroups(dualRoleGroups, pathname);
      const profileGroup = visible.find((g) => !g.context && g.items.some((item) => item.icon === "professional" || item.href === "/profile"));

      expect(profileGroup?.items).toEqual([
        { href: "/dashboard/professional", label: "Professional Profile", icon: "professional" },
      ]);
    }
  });

  it("keeps the bottom Profile link pointing at /profile while the customer context is active", () => {
    for (const pathname of ["/requests", "/appointments/123", "/jobs"]) {
      const visible = resolveVisibleNavGroups(dualRoleGroups, pathname);
      const profileGroup = visible.find((g) => !g.context && g.items.some((item) => item.href === "/profile"));

      expect(profileGroup?.items).toEqual([{ href: "/profile", label: "Profile", icon: "profile" }]);
    }
  });

  it("never touches the Profile link for a customer-only account (no Professional context to switch into)", () => {
    const visible = resolveVisibleNavGroups(customerOnlyGroups, "/dashboard");
    const profileGroup = visible.find((g) => !g.context && g.items.some((item) => item.href === "/profile"));

    expect(profileGroup?.items).toEqual([{ href: "/profile", label: "Profile", icon: "profile" }]);
  });

  /**
   * Root-cause regression: the sidebar previously rendered two
   * "Professional Profile" links at once while the Professional context
   * was active — one embedded in the "Professional" group's own item
   * list, and a second from the context-less Profile group being
   * relabeled for that context (see build-dashboard-nav-groups.ts's doc
   * comment on `PROFESSIONAL_NAV_GROUP`). Asserts there is exactly one
   * `/dashboard/professional` link, and exactly one item whose label is
   * "Professional Profile", anywhere in the rendered sidebar.
   */
  it("never renders a duplicate Professional Profile link while the Professional context is active", () => {
    for (const pathname of ["/dashboard/professional", "/dashboard/professional/requests", "/messages", "/disputes", "/support-tickets"]) {
      const visible = resolveVisibleNavGroups(dualRoleGroups, pathname);
      const allItems = visible.flatMap((g) => g.items);

      expect(allItems.filter((item) => item.href === "/dashboard/professional")).toHaveLength(1);
      expect(allItems.filter((item) => item.label === "Professional Profile")).toHaveLength(1);
    }
  });

  /**
   * Pins down the exact required sidebar order for the Professional
   * context: main workspace items (ending in Companies), then a small
   * gap, then the Messages/Disputes/Support communication cluster, then a
   * final gap before the standalone Professional Profile section. Sign
   * out is rendered outside `navGroups` entirely (DashboardShell's own
   * sidebar footer), so it's intentionally not part of this list.
   */
  it("renders the Professional sidebar in the exact required order", () => {
    const visible = resolveVisibleNavGroups(dualRoleGroups, "/dashboard/professional");
    const orderedHrefs = visible.flatMap((g) => g.items.map((item) => item.href));

    expect(orderedHrefs).toEqual([
      "/dashboard",
      "/dashboard/professional/requests",
      "/dashboard/professional/quotes",
      "/dashboard/professional/appointments",
      "/dashboard/professional/jobs",
      "/dashboard/company",
      "/messages",
      "/disputes",
      "/support-tickets",
      "/dashboard/professional",
    ]);
  });

  it("groups Messages/Disputes/Support into their own visually-separated block, distinct from the main Professional workspace group", () => {
    const visible = resolveVisibleNavGroups(dualRoleGroups, "/dashboard/professional");
    const communicationGroup = visible.find((g) => g.items.some((item) => item.href === "/messages"));

    expect(communicationGroup?.title).toBeUndefined();
    expect(communicationGroup?.items.map((item) => item.href)).toEqual(["/messages", "/disputes", "/support-tickets"]);
  });
});
