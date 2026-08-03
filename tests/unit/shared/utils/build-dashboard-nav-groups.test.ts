import { describe, expect, it } from "vitest";

import { buildDashboardNavGroups } from "@/shared/utils/build-dashboard-nav-groups";

/**
 * Regression coverage for the professional-dashboard UX pass: the sidebar
 * nav construction moved out of `(dashboard)/layout.tsx` into this pure
 * function so it's testable without rendering React. The core requirement
 * from the underlying request is dual-role safety — a PROVIDER account
 * must gain the "Professional" group *in addition to*, never instead of,
 * the base (customer) group.
 */
describe("buildDashboardNavGroups", () => {
  it("gives an ordinary customer only the base group and the profile group", () => {
    const groups = buildDashboardNavGroups({ isProfessional: false, isAdmin: false });

    expect(groups).toHaveLength(2);
    expect(groups[0]?.title).toBeUndefined();
    expect(groups[0]?.items.map((item) => item.href)).toEqual([
      "/dashboard",
      "/requests",
      "/appointments",
      "/jobs",
      "/messages",
      "/disputes",
      "/support-tickets",
    ]);
    expect(groups.at(-1)?.items).toEqual([{ href: "/profile", label: "Profile", icon: "profile" }]);
  });

  it("keeps the base (customer) group completely unchanged for a PROVIDER account", () => {
    const customerGroups = buildDashboardNavGroups({ isProfessional: false, isAdmin: false });
    const professionalGroups = buildDashboardNavGroups({ isProfessional: true, isAdmin: false });

    expect(professionalGroups[0]).toEqual(customerGroups[0]);
  });

  it("adds a 'Professional' group containing the main workspace destinations, with Companies directly after My jobs and no embedded Professional profile item", () => {
    const groups = buildDashboardNavGroups({ isProfessional: true, isAdmin: false });
    const professionalGroup = groups.find((group) => group.title === "Professional");

    expect(professionalGroup).toBeDefined();
    expect(professionalGroup?.items.map((item) => item.href)).toEqual([
      "/dashboard",
      "/dashboard/professional/requests",
      "/dashboard/professional/quotes",
      "/dashboard/professional/appointments",
      "/dashboard/professional/jobs",
      "/dashboard/company",
    ]);
    // "Professional profile" must never appear here — it lives solely in
    // the context-less Profile group (see dashboard-shell-context.test.ts),
    // otherwise the sidebar renders two Professional Profile links.
    expect(professionalGroup?.items.some((item) => item.href === "/dashboard/professional")).toBe(
      false,
    );
  });

  it("adds a separate, untitled communication group (Messages/Disputes/Support) immediately after the Professional group, for visual spacing", () => {
    const groups = buildDashboardNavGroups({ isProfessional: true, isAdmin: false });
    const professionalIndex = groups.findIndex((group) => group.title === "Professional");
    const communicationGroup = groups[professionalIndex + 1];

    expect(communicationGroup?.title).toBeUndefined();
    expect(communicationGroup?.context).toBe("professional");
    expect(communicationGroup?.items.map((item) => item.href)).toEqual([
      "/messages",
      "/disputes",
      "/support-tickets",
    ]);
  });

  it("tags the base group 'customer' and both Professional groups 'professional', so DashboardShell can filter by active context", () => {
    const groups = buildDashboardNavGroups({ isProfessional: true, isAdmin: false });

    expect(groups[0]?.context).toBe("customer");
    expect(groups.filter((g) => g.context === "professional")).toHaveLength(2);
    // Admin/Profile groups are context-less — always shown regardless of
    // which side of the marketplace the sidebar is currently focused on.
    expect(groups.at(-1)?.context).toBeUndefined();
  });

  it("never shows the 'Professional' group to a non-professional account", () => {
    const groups = buildDashboardNavGroups({ isProfessional: false, isAdmin: false });

    expect(groups.some((group) => group.title === "Professional")).toBe(false);
    expect(
      groups.some((group) => group.items.some((item) => item.href === "/dashboard/professional")),
    ).toBe(false);
  });

  it("adds the 'Admin' group only for admins, independent of professional status", () => {
    const adminOnly = buildDashboardNavGroups({ isProfessional: false, isAdmin: true });
    const adminAndProfessional = buildDashboardNavGroups({ isProfessional: true, isAdmin: true });

    expect(adminOnly.some((group) => group.title === "Admin")).toBe(true);
    expect(adminAndProfessional.map((group) => group.title)).toEqual([
      undefined,
      "Professional",
      undefined,
      "Admin",
      undefined,
    ]);
  });

  it("always ends with the Profile group regardless of role combination", () => {
    const groups = buildDashboardNavGroups({ isProfessional: true, isAdmin: true });

    expect(groups.at(-1)?.items).toEqual([{ href: "/profile", label: "Profile", icon: "profile" }]);
  });
});
