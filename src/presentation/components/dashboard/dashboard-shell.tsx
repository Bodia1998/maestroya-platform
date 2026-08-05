"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  AlertTriangle,
  Award,
  Bell,
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
} from "lucide-react";

import { cn } from "@/shared/utils/cn";
import { logoutAction } from "@/app/auth/logout/actions";
import { Avatar } from "@/components/ui/avatar";
import {
  Drawer,
  DrawerClose,
  DrawerHeader,
} from "@/components/ui/drawer";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { IconButton } from "@/components/ui/icon-button";
import { Tooltip } from "@/components/ui/tooltip";
import { LanguageSwitcher } from "@/components/shared/language-switcher";

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
 *
 * Deliberately excludes `/messages`, `/disputes`, and `/support-tickets` —
 * those three are *shared* modules with no customer-only content of their
 * own (every use case behind them scopes strictly to the session's own
 * userId, never by role — see build-dashboard-nav-groups.ts's own doc
 * comment). Root cause this exclusion fixes: with those three routes in
 * this list, a professional who opened Messages/Disputes/Support from the
 * Professional group had their *entire sidebar* silently flip back to the
 * customer group on that page — reported as "Messages/Support/Disputes
 * switch the nav back to the customer dashboard". Falling through to the
 * "otherwise" rule below instead means those three routes now resolve to
 * whichever context is the account's actual default (professional for any
 * PROVIDER account, exactly like the shared `/dashboard` overview) — never
 * a silent switch away from Professional.
 */
const CUSTOMER_CONTEXT_PREFIXES = ["/requests", "/appointments", "/jobs"];

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
 *   3. Otherwise (the shared `/dashboard` overview, `/profile`, the shared
 *      Messages/Disputes/Support modules, etc.) — defaults to
 *      "professional" for a professional account, never silently falling
 *      back to the customer group as the default view (a PROVIDER account
 *      must never see the customer dashboard as its *default* dashboard —
 *      see resolve-post-login-destination.ts, which lands a professional
 *      on `/dashboard` after login specifically because it already renders
 *      a "Professional overview" section for PROVIDER accounts). Plain
 *      customer accounts are unaffected — with no Professional group to
 *      default into, they still just get the customer group everywhere.
 *
 * Note this means Messages/Disputes/Support always render inside the
 * Professional context for a PROVIDER account, on every visit, regardless
 * of which link was clicked to get there — there is deliberately no
 * "remember where I came from" state. That is exactly the product
 * requirement: a professional must never see their navigation flip to the
 * customer dashboard while working a shared module.
 */
export function resolveVisibleNavGroups(navGroups: DashboardNavGroup[], pathname: string): DashboardNavGroup[] {
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

  // The context-less "Profile" item (bottom of the sidebar, always visible
  // regardless of context) must never open the *customer* profile page
  // while the Professional workspace is active — that was reported as "the
  // Profile button opens the CUSTOMER profile". Swapped for the same
  // "Professional profile" destination the Professional group itself
  // already links to (see PROFESSIONAL_NAV_GROUP in
  // build-dashboard-nav-groups.ts) whenever `activeContext` is
  // "professional"; left completely unchanged for the customer context.
  const sharedGroups = navGroups
    .filter((group) => !group.context)
    .map((group) => ({
      ...group,
      items: group.items.map((item) =>
        activeContext === "professional" && item.href === "/profile"
          ? { href: "/dashboard/professional", label: "Professional Profile", icon: "professional" as const }
          : item,
      ),
    }));

  // Only ever offers a way *into* the Professional side from the customer
  // context — never the reverse. The professional dashboard must contain
  // only professional functionality (no "Switch to Customer view" or any
  // other customer-only navigation), so no link back to the customer
  // context is ever added here, regardless of whether the account also
  // has a customer group. `hasCustomerGroup` is intentionally unused for
  // that direction.
  const switchGroup: DashboardNavGroup | null =
    activeContext === "customer" && hasProfessionalGroup
      ? { items: [{ href: "/dashboard/professional", label: "Switch to Professional dashboard", icon: "professional" }] }
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
                  "group flex min-h-11 items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium outline-none transition-colors",
                  "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card",
                  active
                    ? "bg-primary/10 text-primary"
                    : "text-foreground/75 hover:bg-muted hover:text-foreground",
                )}
              >
                <Icon
                  className={cn(
                    "h-[18px] w-[18px] shrink-0 transition-colors",
                    active ? "text-primary" : "text-foreground/50 group-hover:text-foreground",
                  )}
                  aria-hidden
                />
                <span className="truncate">{item.label}</span>
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

function BrandMark() {
  return (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary text-sm font-bold text-primary-foreground">
      M
    </span>
  );
}

function SignOutButton({ className }: { className?: string }) {
  return (
    <form action={logoutAction}>
      <button
        type="submit"
        className={cn(
          "flex min-h-11 w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium text-foreground/75 outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
          className,
        )}
      >
        <LogOut className="h-[18px] w-[18px] shrink-0 text-foreground/50" aria-hidden />
        Sign out
      </button>
    </form>
  );
}

function UserMenuTrigger({ userEmail }: { userEmail: string | null }) {
  const [open, setOpen] = useState(false);

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Account menu"
          className="flex h-10 items-center gap-2 rounded-full px-1.5 outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring sm:pr-3"
        >
          <Avatar alt={userEmail ?? "Account"} size="sm" />
          {userEmail && (
            <span className="hidden max-w-[12rem] truncate text-sm font-medium text-foreground/80 sm:inline">
              {userEmail}
            </span>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        {userEmail && (
          <>
            <div className="px-3 py-2">
              <p className="truncate text-sm font-medium text-foreground">{userEmail}</p>
            </div>
            <DropdownMenuSeparator />
          </>
        )}
        <Link
          href="/profile"
          role="menuitem"
          onClick={() => setOpen(false)}
          className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <User className="h-4 w-4" aria-hidden />
          Profile
        </Link>
        <DropdownMenuSeparator />
        <form action={logoutAction}>
          <DropdownMenuItem type="submit" destructive className="flex items-center gap-2">
            <LogOut className="h-4 w-4" aria-hidden />
            Sign out
          </DropdownMenuItem>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
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
      <a
        href="#main-content"
        className="sr-only rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-modal"
      >
        Skip to main content
      </a>

      {/* Desktop sidebar */}
      <aside
        className="fixed inset-y-0 hidden w-64 flex-col border-r border-border bg-card/60 px-3 py-6 lg:flex"
        aria-label="Sidebar"
      >
        <Link href="/dashboard" className="mb-6 flex items-center gap-2 px-3 text-lg font-bold tracking-tight text-foreground">
          <BrandMark />
          MaestroYa
        </Link>
        <div className="flex-1 overflow-y-auto">
          <NavLinks navGroups={visibleNavGroups} pathname={pathname} />
        </div>
        <div className="border-t border-border pt-3">
          <SignOutButton />
        </div>
      </aside>

      {/* Mobile drawer */}
      <Drawer open={mobileOpen} onOpenChange={setMobileOpen} side="left">
        <DrawerClose onClose={() => setMobileOpen(false)} />
        <DrawerHeader>
          <Link
            href="/dashboard"
            onClick={() => setMobileOpen(false)}
            className="flex items-center gap-2 text-lg font-bold tracking-tight text-foreground"
          >
            <BrandMark />
            MaestroYa
          </Link>
        </DrawerHeader>
        <div className="flex-1 overflow-y-auto">
          <NavLinks navGroups={visibleNavGroups} pathname={pathname} onNavigate={() => setMobileOpen(false)} />
        </div>
        <div className="border-t border-border pt-3">
          <SignOutButton />
        </div>
      </Drawer>

      {/* Content column */}
      <div className="flex min-w-0 flex-1 flex-col lg:pl-64">
        <header className="sticky top-0 z-sticky flex h-16 shrink-0 items-center gap-2 border-b border-border bg-background/90 px-4 backdrop-blur sm:px-6 lg:px-8">
          <IconButton
            variant="ghost"
            aria-label="Open menu"
            onClick={() => setMobileOpen(true)}
            className="lg:hidden"
          >
            <Menu className="h-5 w-5" aria-hidden />
          </IconButton>

          <Link
            href="/dashboard"
            className="flex items-center gap-2 text-base font-bold tracking-tight text-foreground lg:hidden"
          >
            <BrandMark />
            <span>MaestroYa</span>
          </Link>

          <div className="ml-auto flex items-center gap-1 sm:gap-2">
            <LanguageSwitcher compact />
            <Tooltip content="Notifications">
              <IconButton variant="ghost" aria-label="Notifications">
                <Bell className="h-[18px] w-[18px]" aria-hidden />
              </IconButton>
            </Tooltip>
            <UserMenuTrigger userEmail={userEmail} />
          </div>
        </header>

        {banner && <div className="px-4 pt-4 sm:px-6 lg:px-8">{banner}</div>}

        <main id="main-content" className="flex-1 focus:outline-none" tabIndex={-1}>
          <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</div>
        </main>
      </div>
    </div>
  );
}
