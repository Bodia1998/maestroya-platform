import { redirect } from "next/navigation";

import { ROLES, getCurrentUser } from "@/infrastructure/auth/rbac";
import { AdminNav } from "./admin-nav";

/**
 * Admin Panel module (Module 16): guards every route nested under
 * `/admin` with a single role check here, same "layout does the guarding,
 * pages don't repeat it" convention as (dashboard)/layout.tsx's own auth
 * check. This is defense-in-depth alongside middleware.ts's existing
 * `ROLE_GATED_PREFIXES` entry for `/admin` (added when Authentication was
 * built, specifically anticipating this module — see middleware.ts) — an
 * unauthenticated or non-admin request is already redirected before it
 * gets here, but every Server Component/Action under this tree re-checks
 * independently rather than trusting the network edge alone, matching the
 * "never trust a single layer" principle the rest of this codebase's admin
 * Server Actions also follow (see admin/actions.ts).
 */
const NAV_ITEMS = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/users", label: "Users" },
  { href: "/admin/professionals", label: "Professionals" },
  { href: "/admin/verifications", label: "Verifications" },
  { href: "/admin/companies", label: "Companies" },
  { href: "/admin/company-verifications", label: "Company verifications" },
  { href: "/admin/service-requests", label: "Service requests" },
  { href: "/admin/quotes", label: "Quotes" },
  { href: "/admin/jobs", label: "Appointments & jobs" },
  { href: "/admin/reviews", label: "Reviews" },
  { href: "/admin/portfolio", label: "Portfolio" },
  { href: "/admin/audit-logs", label: "Audit log" },
  { href: "/admin/reconciliation", label: "Reconciliation" },
];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/auth/login?callbackUrl=/admin");
  }
  const roles = user.roles ?? [];
  const isAdmin = roles.includes(ROLES.ADMIN) || roles.includes(ROLES.SUPER_ADMIN);
  if (!isAdmin) {
    redirect("/");
  }

  return (
    <div className="flex w-full flex-col gap-6 lg:flex-row lg:gap-8">
      <aside className="lg:w-56 lg:shrink-0" aria-label="Admin sidebar">
        <AdminNav items={NAV_ITEMS} />
      </aside>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
