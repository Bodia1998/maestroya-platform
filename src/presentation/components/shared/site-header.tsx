import Link from "next/link";

import { getTranslations } from "next-intl/server";

import { getCurrentUser, ROLES } from "@/infrastructure/auth/rbac";
import { ButtonLink } from "@/components/ui/button-link";
import { LanguageSwitcher } from "./language-switcher";
import { MobileNav } from "./mobile-nav";
import { UserMenu } from "./user-menu";

/**
 * Module 29 — Internationalization: hrefs stay constant, labels come from
 * the `nav` namespace. Keeping the two apart (rather than one array of
 * pre-translated objects per locale) is what makes a new language a
 * translation-file-only change here too.
 */
const NAV_LINKS = [
  { href: "/search", labelKey: "search" },
  { href: "/professionals", labelKey: "professionals" },
  { href: "/#como-funciona", labelKey: "howItWorks" },
] as const;

/**
 * Marketing site header — Server Component that reads the session once
 * (via the existing `getCurrentUser` seam, not a new auth call) and
 * passes only what's needed down to the small client islands (mobile
 * menu toggle, user menu dropdown). No new auth logic — signed-out state
 * shows login/register CTAs, signed-in state shows an account entry
 * point at the existing `/dashboard` (or `/dashboard/professional`)
 * route.
 */
export async function SiteHeader() {
  const [user, t] = await Promise.all([getCurrentUser(), getTranslations("nav")]);
  const isProfessional = user?.roles?.includes(ROLES.PROVIDER) ?? false;
  const links = NAV_LINKS.map((link) => ({ href: link.href, label: t(link.labelKey) }));

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/90 backdrop-blur">
      <div className="container flex h-16 items-center justify-between gap-4">
        <Link
          href="/"
          className="flex items-center gap-2 text-lg font-bold tracking-tight text-foreground"
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            M
          </span>
          MaestroYa
        </Link>

        <nav className="hidden items-center gap-1 lg:flex" aria-label={t("mainNavLabel")}>
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="rounded-md px-3 py-2 text-sm font-medium text-foreground/75 transition-colors hover:bg-muted hover:text-foreground"
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="hidden items-center gap-2 lg:flex">
          {/* Quick-settings dropdown, mirroring UserMenu's own pattern —
              the header is where a visitor looks for a language toggle,
              and a guest (who has no Settings page at all) has nowhere
              else to change it. */}
          <LanguageSwitcher compact />
          {user ? (
            <UserMenu label={user.email ?? t("account")} isProfessional={isProfessional} />
          ) : (
            <>
              {/* "Soy profesional" ("I'm a professional") is a *login* entry
                  point for an existing professional, distinct from
                  professional-cta.tsx's "Unirme como profesional" ("Join as
                  a professional") *registration* CTA below on the marketing
                  page — see resolve-post-login-destination.ts's `loginIntent`
                  for how `?intent=professional` is used once login
                  succeeds. Previously this pointed at plain `/auth/register`
                  (identical to "Crear cuenta"), which was the actual bug:
                  an existing professional clicking it landed in the
                  ordinary customer registration flow instead of logging in. */}
              <ButtonLink href="/auth/login?intent=professional" variant="ghost" size="sm">
                {t("professionalCta")}
              </ButtonLink>
              <ButtonLink href="/auth/login" variant="outline" size="sm">
                {t("login")}
              </ButtonLink>
              <ButtonLink href="/auth/register" size="sm">
                {t("register")}
              </ButtonLink>
            </>
          )}
        </div>

        <MobileNav links={links} isSignedIn={Boolean(user)} isProfessional={isProfessional} />
      </div>
    </header>
  );
}
