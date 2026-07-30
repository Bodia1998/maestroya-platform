import type { DashboardNavGroup } from "@/components/dashboard/dashboard-shell";

/**
 * Pure construction of the dashboard sidebar's nav groups, extracted out of
 * `(dashboard)/layout.tsx` so the professional-vs-customer nav shape is
 * independently unit-testable (see resolve-post-login-destination.ts for
 * the same "pure decision function next to the server component that
 * calls it" convention used elsewhere in this codebase).
 *
 * Only `import type` is used from dashboard-shell.tsx — that "use client"
 * component's types are erased at compile time, so this file stays a
 * plain, framework-agnostic pure function with no client/server boundary
 * concerns of its own.
 *
 * Every CUSTOMER account keeps the base group unchanged regardless of role
 * — PROVIDER is additive, never a replacement (dual-role accounts must
 * keep full customer access; see the "Professional" group below, which is
 * only ever appended, never substituted in).
 */
const BASE_NAV_GROUP: DashboardNavGroup = {
  items: [
    { href: "/dashboard", label: "Dashboard", icon: "dashboard" },
    { href: "/requests", label: "Service requests", icon: "requests" },
    { href: "/appointments", label: "Appointments", icon: "appointments" },
    { href: "/jobs", label: "Jobs", icon: "jobs" },
    { href: "/messages", label: "Messages", icon: "messages" },
    { href: "/disputes", label: "Disputes", icon: "disputes" },
    { href: "/support-tickets", label: "Support", icon: "support" },
  ],
};

/**
 * Professional-only destinations. Deliberately distinct hrefs from the
 * base group's customer-facing equivalents (e.g. `/appointments` vs
 * `/dashboard/professional/appointments`) — these are the professional's
 * own "my appointments"/"my jobs" views (ListAppointmentsForProfessionalUseCase
 * / ListJobsForProfessionalUseCase), not the customer-facing pages the base
 * group already links to. "Available requests" intentionally reuses the
 * `requests` icon (no new icon needed) but a distinct label/href so it
 * never reads as "create a request" — see the requests page itself for the
 * full wording rationale.
 */
const PROFESSIONAL_NAV_GROUP: DashboardNavGroup = {
  title: "Professional",
  items: [
    { href: "/dashboard", label: "Professional dashboard", icon: "dashboard" },
    { href: "/dashboard/professional/requests", label: "Available requests", icon: "requests" },
    { href: "/dashboard/professional/quotes", label: "My quotes", icon: "quotes" },
    { href: "/dashboard/professional/appointments", label: "My appointments", icon: "appointments" },
    { href: "/dashboard/professional/jobs", label: "My jobs", icon: "jobs" },
    { href: "/dashboard/professional", label: "Professional profile", icon: "professional" },
    { href: "/dashboard/company", label: "Companies", icon: "companies" },
  ],
};

const ADMIN_NAV_GROUP: DashboardNavGroup = {
  title: "Admin",
  items: [{ href: "/admin", label: "Admin panel", icon: "admin" }],
};

const PROFILE_NAV_GROUP: DashboardNavGroup = {
  items: [{ href: "/profile", label: "Profile", icon: "profile" }],
};

export interface BuildDashboardNavGroupsOptions {
  isProfessional: boolean;
  isAdmin: boolean;
}

export function buildDashboardNavGroups({
  isProfessional,
  isAdmin,
}: BuildDashboardNavGroupsOptions): DashboardNavGroup[] {
  const groups: DashboardNavGroup[] = [BASE_NAV_GROUP];

  if (isProfessional) {
    groups.push(PROFESSIONAL_NAV_GROUP);
  }

  if (isAdmin) {
    groups.push(ADMIN_NAV_GROUP);
  }

  groups.push(PROFILE_NAV_GROUP);

  return groups;
}
