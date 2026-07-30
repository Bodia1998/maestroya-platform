import { getCurrentUser, ROLES } from "@/infrastructure/auth/rbac";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { ProfessionalProfileBanner } from "@/components/dashboard/professional-profile-banner";
import { buildDashboardNavGroups } from "@/shared/utils/build-dashboard-nav-groups";
import {
  buildNoProfessionalProfileBanner,
  buildProfessionalProfileBanner,
} from "@/shared/utils/professional-profile-banner";
import { makeGetProfessionalByUserIdUseCase } from "@/application/use-cases/professional/compose";
import { makeGetProfileUseCase } from "@/application/use-cases/profile/compose";
import { makeListPortfolioItemsUseCase } from "@/application/use-cases/portfolio/compose";

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
 * here is a UX nicety, not a security boundary. Nav shape itself is built
 * by the pure `buildDashboardNavGroups` (see that file for why it's
 * extracted) — this layout only decides the `isProfessional`/`isAdmin`
 * inputs to it.
 *
 * Professional profile completion banner: computed here (once, for every
 * page under this layout) rather than by individual pages, so it stays
 * visible across navigation instead of vanishing the moment a professional
 * leaves whichever single page used to own the "set up your profile"
 * prompt — see professional-profile-banner.ts's own doc comment for the
 * full root-cause writeup. Only ever computed for signed-in PROVIDER
 * accounts; customers see no banner and their dashboard is completely
 * unaffected. The three reads below (professional profile, general user
 * profile, portfolio existence) reuse existing use cases already called
 * elsewhere in this codebase for the same data (dashboard/professional/page.tsx,
 * profile/page.tsx, and the portfolio pages respectively) — no new domain
 * logic, no new queries beyond what those pages already issue per visit.
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

  const navGroups = buildDashboardNavGroups({ isProfessional, isAdmin });

  let banner: React.ReactNode = null;
  if (isProfessional && user) {
    const professional = await makeGetProfessionalByUserIdUseCase().execute(user.id);

    if (!professional) {
      banner = <ProfessionalProfileBanner info={buildNoProfessionalProfileBanner()} />;
    } else {
      const [{ profile, address }, portfolioItems] = await Promise.all([
        makeGetProfileUseCase().execute(user.id),
        makeListPortfolioItemsUseCase().execute(professional.id, { limit: 1, offset: 0 }),
      ]);

      const info = buildProfessionalProfileBanner({
        hasHeadlineOrDescription: Boolean(professional.headline),
        hasBioOrDescription: Boolean(professional.bio),
        hasCategories: professional.categoryIds.length > 0,
        hasLocation: Boolean(address?.city),
        hasAvatarOrLogo: Boolean(profile.image),
        hasContactInfo: Boolean(professional.contactEmail || professional.contactPhone),
        hasPortfolio: portfolioItems.length > 0,
      });

      banner = <ProfessionalProfileBanner info={info} />;
    }
  }

  return (
    <DashboardShell navGroups={navGroups} userEmail={user?.email ?? null} banner={banner}>
      {children}
    </DashboardShell>
  );
}
