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
    for (const pathname of ["/requests", "/appointments/123", "/jobs", "/messages", "/disputes", "/support-tickets"]) {
      const visible = resolveVisibleNavGroups(dualRoleGroups, pathname);
      expect(visible.some((g) => g.context === "professional")).toBe(false);
      expect(visible.some((g) => g.context === "customer")).toBe(true);
      expect(
        visible.some((g) => g.items.some((item) => item.href === "/dashboard/professional")),
      ).toBe(true);
    }
  });

  it("adds a single switch-to-Professional link (not the full group) when showing the customer context to a dual-role account", () => {
    const visible = resolveVisibleNavGroups(dualRoleGroups, "/requests");
    const switchGroup = visible.find(
      (g) => !g.context && g.items.some((item) => item.href === "/dashboard/professional"),
    );

    expect(switchGroup?.items).toHaveLength(1);
  });

  it("adds a single switch-to-Customer link (not the full group) when showing the professional context", () => {
    const visible = resolveVisibleNavGroups(dualRoleGroups, "/dashboard/professional/requests");
    const switchGroup = visible.find((g) => !g.context && g.items.some((item) => item.href === "/requests"));

    expect(switchGroup?.items).toHaveLength(1);
  });

  it("never adds a switch link for a customer-only account (nothing to switch to)", () => {
    const visible = resolveVisibleNavGroups(customerOnlyGroups, "/requests");

    expect(visible.some((g) => g.items.some((item) => item.href === "/dashboard/professional"))).toBe(false);
  });

  it("always keeps context-less groups (Profile) visible regardless of active context", () => {
    const inCustomerContext = resolveVisibleNavGroups(dualRoleGroups, "/requests");
    const inProfessionalContext = resolveVisibleNavGroups(dualRoleGroups, "/dashboard/professional");

    expect(inCustomerContext.some((g) => g.items.some((item) => item.href === "/profile"))).toBe(true);
    expect(inProfessionalContext.some((g) => g.items.some((item) => item.href === "/profile"))).toBe(true);
  });
});
