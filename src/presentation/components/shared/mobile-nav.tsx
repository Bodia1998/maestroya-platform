"use client";

import Link from "next/link";
import { useState } from "react";
import { LayoutDashboard, LogOut, Menu, X } from "lucide-react";

import { ButtonLink } from "@/components/ui/button-link";

export interface MobileNavProps {
  links: Array<{ href: string; label: string }>;
  isSignedIn: boolean;
  isProfessional: boolean;
}

/** Mobile menu — a simple full-screen panel, no drawer library needed. */
export function MobileNav({ links, isSignedIn, isProfessional }: MobileNavProps) {
  const [open, setOpen] = useState(false);
  const dashboardHref = isProfessional ? "/dashboard/professional" : "/dashboard";

  return (
    <div className="lg:hidden">
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Abrir menú"
        aria-expanded={open}
        className="flex h-10 w-10 items-center justify-center rounded-md text-foreground hover:bg-muted"
      >
        <Menu className="h-5 w-5" aria-hidden />
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex flex-col bg-background animate-fade-in">
          <div className="container flex h-16 items-center justify-between">
            <Link href="/" className="text-lg font-bold" onClick={() => setOpen(false)}>
              MaestroYa
            </Link>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Cerrar menú"
              className="flex h-10 w-10 items-center justify-center rounded-md hover:bg-muted"
            >
              <X className="h-5 w-5" aria-hidden />
            </button>
          </div>

          <nav className="container flex flex-col gap-1 py-4" aria-label="Navegación móvil">
            {links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setOpen(false)}
                className="rounded-md px-3 py-3 text-base font-medium text-foreground hover:bg-muted"
              >
                {link.label}
              </Link>
            ))}
            {isSignedIn && (
              <Link
                href={dashboardHref}
                onClick={() => setOpen(false)}
                className="flex items-center gap-2 rounded-md px-3 py-3 text-base font-medium text-foreground hover:bg-muted"
              >
                <LayoutDashboard className="h-4 w-4" aria-hidden />
                Mi panel
              </Link>
            )}
          </nav>

          <div className="container mt-auto flex flex-col gap-3 border-t border-border py-6">
            {isSignedIn ? (
              <Link
                href="/auth/logout"
                onClick={() => setOpen(false)}
                className="flex items-center justify-center gap-2 rounded-md border border-border px-4 py-2.5 text-sm font-medium"
              >
                <LogOut className="h-4 w-4" aria-hidden />
                Cerrar sesión
              </Link>
            ) : (
              <>
                <ButtonLink href="/auth/login" variant="outline" onClick={() => setOpen(false)}>
                  Iniciar sesión
                </ButtonLink>
                <ButtonLink href="/auth/register" onClick={() => setOpen(false)}>
                  Crear cuenta
                </ButtonLink>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
