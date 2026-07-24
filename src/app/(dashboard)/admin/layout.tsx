import Link from "next/link";
import { redirect } from "next/navigation";

import { ROLES, getCurrentUser } from "@/infrastructure/auth/rbac";

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
    <div className="mx-auto flex w-full max-w-6xl gap-8 px-4 py-10">
      <nav className="flex w-48 shrink-0 flex-col gap-1">
        <p className="mb-2 px-2 text-xs font-semibold uppercase tracking-wide text-foreground/50">Admin</p>
        {NAV_ITEMS.map((item) => (
          <Link key={item.href} href={item.href} className="rounded-md px-2 py-1.5 text-sm hover:bg-black/5">
            {item.label}
          </Link>
        ))}
      </nav>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
