import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

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
  { href: "/admin", labelKey: "overview" },
  { href: "/admin/users", labelKey: "users" },
  { href: "/admin/professionals", labelKey: "professionals" },
  { href: "/admin/verifications", labelKey: "verifications" },
  { href: "/admin/companies", labelKey: "companies" },
  { href: "/admin/company-verifications", labelKey: "companyVerifications" },
  { href: "/admin/service-requests", labelKey: "serviceRequests" },
  { href: "/admin/quotes", labelKey: "quotes" },
  { href: "/admin/jobs", labelKey: "jobs" },
  { href: "/admin/reviews", labelKey: "reviews" },
  { href: "/admin/portfolio", labelKey: "portfolio" },
  { href: "/admin/audit-logs", labelKey: "auditLogs" },
  { href: "/admin/ai-visibility", labelKey: "aiVisibility" },
  { href: "/admin/reconciliation", labelKey: "reconciliation" },
  { href: "/admin/partners", labelKey: "partners" },
] as const;

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

  const t = await getTranslations("admin.nav");
  const navItems = NAV_ITEMS.map((item) => ({ href: item.href, label: t(item.labelKey) }));

  return (
    <div className="flex w-full flex-col gap-6 lg:flex-row lg:gap-8">
      <aside className="lg:w-56 lg:shrink-0" aria-label={t("sidebar")}>
        <AdminNav items={navItems} />

      </aside>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
