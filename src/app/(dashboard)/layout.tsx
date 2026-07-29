import { getCurrentUser, ROLES } from "@/infrastructure/auth/rbac";
import { DashboardShell, type DashboardNavGroup } from "@/components/dashboard/dashboard-shell";

/**
 * Layout for authenticated routes.
 *
 * Auth gating for everything under (dashboard) already happens in
 * `middleware.ts` (`PROTECTED_PREFIXES = ["/dashboard"]`, matching this
 * route group's own path) — that is the single, authoritative check.
 *
 * This layout used to *also* call `await auth()` and `redirect("/auth/login")`
 * on its own, independently of middleware. That duplicate check was the
 * cause of a real bug: after a successful credentials sign-in,
 * `signIn({redirect:false})` navigates the browser to `/dashboard` via
 * `window.location.href` (a fresh top-level request) as soon as the
 * session cookie is set. Middleware's own `auth()` read of that request
 * correctly saw the new session and let it through (200) — but this
 * layout then ran a *second*, independent `auth()` evaluation for the
 * same request, and any timing/ordering difference between the two
 * separate reads was enough to occasionally see the session as not yet
 * present, firing its own `redirect("/auth/login")` right after the page
 * had already been allowed through — exactly the "GET /dashboard 200
 * immediately followed by GET /auth/login" bounce. Removing the
 * duplicate check removes the only place that redirect could come from,
 * without weakening protection: middleware covers the identical path
 * prefix and remains fully enforced.
 *
 * What this layout now adds is purely presentational: the app shell
 * (sidebar/header) built once here so every page under (dashboard) gets
 * consistent navigation without duplicating chrome in each page. It reads
 * the session only through the existing `getCurrentUser` seam (never
 * `auth()` directly, never a `redirect()`) — a null user here just renders
 * the shell with generic nav/no email label, it can never bounce the
 * request anywhere. Role-gated nav sections (Professional, Admin) are
 * shown/hidden based on the same `roles` array `middleware.ts` and
 * `rbac.ts` already use; each linked route still enforces its own
 * authorization independently (e.g. `admin/layout.tsx`), so hiding a link
 * here is a UX nicety, not a security boundary.
 */
export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();
  const roles = user?.roles ?? [];
  const isProfessional = roles.includes(ROLES.PROVIDER);
  const isAdmin = roles.includes(ROLES.ADMIN) || roles.includes(ROLES.SUPER_ADMIN);

  const navGroups: DashboardNavGroup[] = [
    {
      items: [
        { href: "/dashboard", label: "Dashboard", icon: "dashboard" },
        { href: "/requests", label: "Service requests", icon: "requests" },
        { href: "/appointments", label: "Appointments", icon: "appointments" },
        { href: "/jobs", label: "Jobs", icon: "jobs" },
        { href: "/messages", label: "Messages", icon: "messages" },
        { href: "/disputes", label: "Disputes", icon: "disputes" },
        { href: "/support-tickets", label: "Support", icon: "support" },
      ],
    },
  ];

  if (isProfessional) {
    navGroups.push({
      title: "Professional",
      items: [
        { href: "/dashboard/professional", label: "Professional profile", icon: "professional" },
        { href: "/dashboard/professional/quotes", label: "My quotes", icon: "quotes" },
        { href: "/dashboard/company", label: "Companies", icon: "companies" },
      ],
    });
  }

  if (isAdmin) {
    navGroups.push({
      title: "Admin",
      items: [{ href: "/admin", label: "Admin panel", icon: "admin" }],
    });
  }

  navGroups.push({
    items: [{ href: "/profile", label: "Profile", icon: "profile" }],
  });

  return (
    <DashboardShell navGroups={navGroups} userEmail={user?.email ?? null}>
      {children}
    </DashboardShell>
  );
}
