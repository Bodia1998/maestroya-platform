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
 * only ever appended, never substituted in). Every professional account
 * also happens to carry the CUSTOMER role too (see RegisterUserUseCase —
 * that is an intentional, unrelated product decision: there is no separate
 * "professional-only" account type in this marketplace), so *both* groups
 * are always structurally present for a PROVIDER account by this point —
 * the two groups are never mutually exclusive at the data level.
 *
 * Root cause this `context` tagging exists to fix: previously both groups
 * (customer + Professional) rendered in the sidebar simultaneously,
 * unconditionally, for any dual-role account — including while the
 * professional was looking at a page entirely about their professional
 * work (e.g. `/dashboard/professional/requests`). That's what made the
 * dashboard feel like two dashboards glued together. `context` doesn't
 * change *who* is entitled to a group (that's still purely
 * `isProfessional`/`isAdmin` below, unchanged) — it lets the presentation
 * layer (`DashboardShell`, which already reads the current pathname via
 * `usePathname()`) show only the group matching *where the user currently
 * is*, plus a single, explicit link to switch contexts — see
 * DashboardShell's own doc comment for that filtering. Groups with no
 * `context` (Admin, Profile) are unaffected — they're relevant regardless
 * of which side of the marketplace the user is currently looking at.
 */
const BASE_NAV_GROUP: DashboardNavGroup = {
  context: "customer",
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
 *
 * "Professional profile" is deliberately NOT an item in this list — it
 * lives solely in the context-less `PROFILE_NAV_GROUP` below, which
 * `resolveVisibleNavGroups` (dashboard-shell.tsx) already relabels to
 * "Professional Profile" -> `/dashboard/professional` while the
 * Professional context is active. Having it in both places rendered two
 * "Professional Profile" links in the sidebar simultaneously — see that
 * file's own doc comment for the fix. Companies stays here, directly after
 * "My jobs", as part of the main professional workspace group (not a
 * bottom-of-sidebar afterthought).
 */
const PROFESSIONAL_NAV_GROUP: DashboardNavGroup = {
  title: "Professional",
  context: "professional",
  items: [
    { href: "/dashboard", label: "Professional dashboard", icon: "dashboard" },
    { href: "/dashboard/professional/requests", label: "Available requests", icon: "requests" },
    { href: "/dashboard/professional/quotes", label: "My quotes", icon: "quotes" },
    { href: "/dashboard/professional/appointments", label: "My appointments", icon: "appointments" },
    { href: "/dashboard/professional/jobs", label: "My jobs", icon: "jobs" },
    { href: "/dashboard/company", label: "Companies", icon: "companies" },
  ],
};

/**
 * Messages/Disputes/Support — a *shared* communication group (every use
 * case behind them scopes strictly to the authenticated session's own
 * userId, never by role — see messages/disputes/support-tickets pages'
 * own doc comments), deliberately linked from both the customer and
 * Professional contexts rather than moved: a professional working in
 * their own context still needs to reach the exact same
 * conversations/tickets a customer-context link would open, just without
 * leaving the professional-labeled part of the sidebar to do it.
 *
 * Kept as its own untitled group (rather than folded into
 * `PROFESSIONAL_NAV_GROUP` above) purely for sidebar layout: `NavLinks`
 * (dashboard-shell.tsx) renders every group in its own block with visual
 * spacing between blocks, so a separate group here is what gives this
 * communication cluster a small gap above it, setting it apart from the
 * main "Professional dashboard / Available requests / ... / Companies"
 * workspace items — same `context: "professional"` as that group, so it
 * still only ever renders while the Professional context is active.
 */
const PROFESSIONAL_COMMUNICATION_NAV_GROUP: DashboardNavGroup = {
  context: "professional",
  items: [
    { href: "/messages", label: "Messages", icon: "messages" },
    { href: "/disputes", label: "Disputes", icon: "disputes" },
    { href: "/support-tickets", label: "Support", icon: "support" },
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
    groups.push(PROFESSIONAL_NAV_GROUP, PROFESSIONAL_COMMUNICATION_NAV_GROUP);
  }

  if (isAdmin) {
    groups.push(ADMIN_NAV_GROUP);
  }

  groups.push(PROFILE_NAV_GROUP);

  return groups;
}
