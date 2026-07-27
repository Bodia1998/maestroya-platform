import Link from "next/link";

import { getCurrentUser, ROLES } from "@/infrastructure/auth/rbac";
import { ButtonLink } from "@/components/ui/button-link";
import { MobileNav } from "./mobile-nav";
import { UserMenu } from "./user-menu";

const NAV_LINKS = [
  { href: "/search", label: "Buscar profesionales" },
  { href: "/professionals", label: "Profesionales" },
  { href: "/#como-funciona", label: "Cómo funciona" },
];

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
  const user = await getCurrentUser();
  const isProfessional = user?.roles?.includes(ROLES.PROVIDER) ?? false;

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/90 backdrop-blur">
      <div className="container flex h-16 items-center justify-between gap-4">
        <Link href="/" className="flex items-center gap-2 text-lg font-bold tracking-tight text-foreground">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            M
          </span>
          MaestroYa
        </Link>

        <nav className="hidden items-center gap-1 lg:flex" aria-label="Navegación principal">
          {NAV_LINKS.map((link) => (
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
          {user ? (
            <UserMenu label={user.email ?? "Mi cuenta"} isProfessional={isProfessional} />
          ) : (
            <>
              <ButtonLink href="/auth/register" variant="ghost" size="sm">
                Soy profesional
              </ButtonLink>
              <ButtonLink href="/auth/login" variant="outline" size="sm">
                Iniciar sesión
              </ButtonLink>
              <ButtonLink href="/auth/register" size="sm">
                Crear cuenta
              </ButtonLink>
            </>
          )}
        </div>

        <MobileNav links={NAV_LINKS} isSignedIn={Boolean(user)} isProfessional={isProfessional} />
      </div>
    </header>
  );
}
