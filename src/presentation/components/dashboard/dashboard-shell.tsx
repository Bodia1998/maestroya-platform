"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  AlertTriangle,
  Award,
  Briefcase,
  Building2,
  CalendarDays,
  FileSignature,
  FileText,
  LayoutDashboard,
  LifeBuoy,
  LogOut,
  Menu,
  MessageSquare,
  Shield,
  User,
  X,
} from "lucide-react";

import { cn } from "@/shared/utils/cn";
import { logoutAction } from "@/app/auth/logout/actions";

const ICONS = {
  dashboard: LayoutDashboard,
  requests: FileText,
  appointments: CalendarDays,
  jobs: Briefcase,
  messages: MessageSquare,
  disputes: AlertTriangle,
  support: LifeBuoy,
  profile: User,
  professional: Award,
  quotes: FileSignature,
  companies: Building2,
  admin: Shield,
} as const;

export type DashboardNavIcon = keyof typeof ICONS;

export interface DashboardNavItem {
  href: string;
  label: string;
  icon: DashboardNavIcon;
}

export interface DashboardNavGroup {
  title?: string;
  /**
   * Which side of the marketplace this group belongs to. `undefined` means
   * "always relevant regardless of context" (Admin, Profile). See
   * `NavLinks`'s own doc comment for how this drives which groups actually
   * render.
   */
  context?: "customer" | "professional";
  items: DashboardNavItem[];
}

export interface DashboardShellProps {
  navGroups: DashboardNavGroup[];
  userEmail: string | null;
  /**
   * Optional persistent notice rendered above every page's content, inside
   * the scrollable content column — e.g. the "complete your professional
   * profile" banner (see professional-profile-banner.ts). Rendered here,
   * at the shell level, rather than by individual pages, so it stays
   * visible across every navigation instead of disappearing when the user
   * leaves whichever single page used to own it. Optional and defaults to
   * nothing rendered, so every existing caller of DashboardShell keeps
   * working unchanged.
   */
  banner?: React.ReactNode;
  children: React.ReactNode;
}

function isActive(pathname: string, href: string): boolean {
  if (href === "/dashboard") return pathname === "/dashboard";
  return pathname === href || pathname.startsWith(`${href}/`);
}

const PROFESSIONAL_CONTEXT_PREFIX = "/dashboard/professional";

/**
 * Routes that are unambiguously customer-side even for a dual-role
 * account — mirrors BASE_NAV_GROUP's own hrefs (minus `/dashboard` itself,
 * which is the shared overview and handled by the "default context" rule
 * below, not this list). Visiting one of these while also a professional
 * still shows the customer group (that page's content *is* customer
 * content — e.g. "my own service requests"), plus a link back to the
 * Professional side.
 */
const CUSTOMER_CONTEXT_PREFIXES = ["/requests", "/appointments", "/jobs", "/messages", "/disputes", "/support-tickets"];

/**
 * Root cause this fixes: the sidebar previously rendered *every* nav group
 * a user was entitled to at once — for a dual-role account (the common
 * case; see build-dashboard-nav-groups.ts's own doc comment on why every
 * professional also has the customer group) that meant the full customer
 * group (Service requests, Appointments, Jobs, Messages, Disputes,
 * Support) and the full "Professional" group both rendered simultaneously,
 * regardless of which one the current page actually belonged to — reported
 * as "a confusing dual dashboard".
 *
 * Fix: derive which single context is "active" from the current pathname
 * (already available here via `usePathname()` — no new plumbing needed)
 * and show only that context's group, plus any context-less groups (Admin,
 * Profile) which are always relevant. A single, explicitly-labeled link is
 * added to cross into the other context when the account actually has
 * access to it — never the other group's full link list — so the
 * underlying dual-role capability is never hidden, only decluttered. This
 * is presentation-only: every route this sidebar links to (or doesn't)
 * still enforces its own authorization independently, exactly as
 * documented on `DashboardShell` below — nothing about *what a user can
 * reach by URL* changes here.
 *
 * Context precedence:
 *   1. Anywhere under `/dashboard/professional` → always "professional".
 *   2. An unambiguously customer-side route (`CUSTOMER_CONTEXT_PREFIXES`)
 *      → always "customer".
 *   3. Otherwise (the shared `/dashboard` overview, `/profile`, etc.) —
 *      defaults to "professional" for a professional account, never
 *      silently falling back to the customer group as the default view
 *      (a PROVIDER account must never see the customer dashboard as its
 *      *default* dashboard — see resolve-post-login-destination.ts, which
 *      lands a professional on `/dashboard` after login specifically
 *      because it already renders a "Professional overview" section for
 *      PROVIDER accounts). Plain customer accounts are unaffected — with
 *      no Professional group to default into, they still just get the
 *      customer group everywhere.
 */
export function resolveVisibleNavGroups(navGroups: DashboardNavGroup[], pathname: string): DashboardNavGroup[] {
  const hasCustomerGroup = navGroups.some((group) => group.context === "customer");
  const hasProfessionalGroup = navGroups.some((group) => group.context === "professional");

  const isExplicitCustomerRoute = CUSTOMER_CONTEXT_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );

  const activeContext: "customer" | "professional" = pathname.startsWith(PROFESSIONAL_CONTEXT_PREFIX)
    ? "professional"
    : isExplicitCustomerRoute
      ? "customer"
      : hasProfessionalGroup
        ? "professional"
        : "customer";

  const contextualGroups = navGroups.filter((group) => group.context === activeContext);
  const sharedGroups = navGroups.filter((group) => !group.context);

  // Targets are deliberately unambiguous routes on the *other* side (never
  // `/dashboard` itself in either direction) — `/dashboard` is the shared
  // overview page and, per the context precedence above, always resolves
  // back to "professional" for a professional account, so a switch link
  // that pointed there would silently fail to actually switch anything for
  // that case.
  const switchGroup: DashboardNavGroup | null =
    activeContext === "customer" && hasProfessionalGroup
      ? { items: [{ href: "/dashboard/professional", label: "Switch to Professional dashboard", icon: "professional" }] }
      : activeContext === "professional" && hasCustomerGroup
        ? { items: [{ href: "/requests", label: "Switch to Customer view", icon: "dashboard" }] }
        : null;

  return [...contextualGroups, ...(switchGroup ? [switchGroup] : []), ...sharedGroups];
}

function NavLinks({ navGroups, pathname, onNavigate }: { navGroups: DashboardNavGroup[]; pathname: string; onNavigate?: () => void }) {
  return (
    <nav className="flex flex-col gap-6" aria-label="Dashboard navigation">
      {navGroups.map((group, groupIndex) => (
        <div key={group.title ?? `group-${groupIndex}`} className="flex flex-col gap-1">
          {group.title && (
            <p className="mb-1 px-3 text-xs font-semibold uppercase tracking-wide text-foreground/50">{group.title}</p>
          )}
          {group.items.map((item) => {
            const Icon = ICONS[item.icon];
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onNavigate}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  active
                    ? "bg-primary/10 text-primary"
                    : "text-foreground/75 hover:bg-muted hover:text-foreground",
                )}
              >
                <Icon className="h-4 w-4 shrink-0" aria-hidden />
                <span className="truncate">{item.label}</span>
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

/**
 * Authenticated application shell: fixed desktop sidebar + top header with
 * a mobile drawer. Pure presentation — no auth logic here at all. The
 * (dashboard) route group's `layout.tsx` remains the only place that reads
 * the session (via the existing `getCurrentUser` seam, never redirecting),
 * and middleware.ts remains the sole authority that decides whether a
 * request reaches this component in the first place.
 */
export function DashboardShell({ navGroups, userEmail, banner, children }: DashboardShellProps) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const visibleNavGroups = resolveVisibleNavGroups(navGroups, pathname);

  return (
    <div className="flex min-h-screen w-full bg-background">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 hidden w-64 flex-col border-r border-border bg-card/60 px-3 py-6 lg:flex">
        <Link href="/dashboard" className="mb-6 flex items-center gap-2 px-3 text-lg font-bold tracking-tight text-foreground">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            M
          </span>
          MaestroYa
        </Link>
        <div className="flex-1 overflow-y-auto">
          <NavLinks navGroups={visibleNavGroups} pathname={pathname} />
        </div>
        <div className="border-t border-border pt-3">
          <form action={logoutAction}>
            <button
              type="submit"
              className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm font-medium text-foreground/75 transition-colors hover:bg-muted hover:text-foreground"
            >
              <LogOut className="h-4 w-4 shrink-0" aria-hidden />
              Sign out
            </button>
          </form>
        </div>
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setMobileOpen(false)} aria-hidden="true" />
          <div className="relative flex w-72 max-w-[80vw] flex-col bg-background px-3 py-6 shadow-xl">
            <div className="mb-6 flex items-center justify-between px-3">
              <Link
                href="/dashboard"
                onClick={() => setMobileOpen(false)}
                className="flex items-center gap-2 text-lg font-bold tracking-tight text-foreground"
              >
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                  M
                </span>
                MaestroYa
              </Link>
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                aria-label="Close menu"
                className="flex h-9 w-9 items-center justify-center rounded-md hover:bg-muted"
              >
                <X className="h-5 w-5" aria-hidden />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">
              <NavLinks navGroups={visibleNavGroups} pathname={pathname} onNavigate={() => setMobileOpen(false)} />
            </div>
            <div className="border-t border-border pt-3">
              <form action={logoutAction}>
                <button
                  type="submit"
                  className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm font-medium text-foreground/75 hover:bg-muted hover:text-foreground"
                >
                  <LogOut className="h-4 w-4 shrink-0" aria-hidden />
                  Sign out
                </button>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Content column */}
      <div className="flex min-w-0 flex-1 flex-col lg:pl-64">
        <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center gap-4 border-b border-border bg-background/90 px-4 backdrop-blur sm:px-6 lg:px-8">
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            aria-label="Open menu"
            className="flex h-10 w-10 items-center justify-center rounded-md text-foreground hover:bg-muted lg:hidden"
          >
            <Menu className="h-5 w-5" aria-hidden />
          </button>

          <div className="ml-auto flex items-center gap-3">
            {userEmail && (
              <span className="hidden max-w-[14rem] truncate text-sm text-foreground/70 sm:inline">{userEmail}</span>
            )}
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
              {(userEmail?.[0] ?? "?").toUpperCase()}
            </span>
          </div>
        </header>

        {banner && <div className="px-4 pt-4 sm:px-6 lg:px-8">{banner}</div>}

        <main className="flex-1">{children}</main>
      </div>
    </div>
  );
}
