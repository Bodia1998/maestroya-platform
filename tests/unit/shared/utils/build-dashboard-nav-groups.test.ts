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

  it("adds a 'Professional' group containing every required professional destination", () => {
    const groups = buildDashboardNavGroups({ isProfessional: true, isAdmin: false });
    const professionalGroup = groups.find((group) => group.title === "Professional");

    expect(professionalGroup).toBeDefined();
    expect(professionalGroup?.items.map((item) => item.href)).toEqual([
      "/dashboard",
      "/dashboard/professional/requests",
      "/dashboard/professional/quotes",
      "/dashboard/professional/appointments",
      "/dashboard/professional/jobs",
      "/dashboard/professional",
      "/dashboard/company",
    ]);
  });

  it("never shows the 'Professional' group to a non-professional account", () => {
    const groups = buildDashboardNavGroups({ isProfessional: false, isAdmin: false });

    expect(groups.some((group) => group.title === "Professional")).toBe(false);
  });

  it("adds the 'Admin' group only for admins, independent of professional status", () => {
    const adminOnly = buildDashboardNavGroups({ isProfessional: false, isAdmin: true });
    const adminAndProfessional = buildDashboardNavGroups({ isProfessional: true, isAdmin: true });

    expect(adminOnly.some((group) => group.title === "Admin")).toBe(true);
    expect(adminAndProfessional.map((group) => group.title)).toEqual([
      undefined,
      "Professional",
      "Admin",
      undefined,
    ]);
  });

  it("always ends with the Profile group regardless of role combination", () => {
    const groups = buildDashboardNavGroups({ isProfessional: true, isAdmin: true });

    expect(groups.at(-1)?.items).toEqual([{ href: "/profile", label: "Profile", icon: "profile" }]);
  });
});
