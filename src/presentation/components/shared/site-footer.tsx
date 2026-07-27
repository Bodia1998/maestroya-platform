import Link from "next/link";

const COLUMNS: Array<{ title: string; links: Array<{ href: string; label: string }> }> = [
  {
    title: "Clientes",
    links: [
      { href: "/search", label: "Buscar profesionales" },
      { href: "/professionals", label: "Directorio de profesionales" },
      { href: "/auth/register", label: "Crear cuenta" },
      { href: "/#como-funciona", label: "Cómo funciona" },
    ],
  },
  {
    title: "Profesionales",
    links: [
      { href: "/auth/register", label: "Únete como profesional" },
      { href: "/auth/login", label: "Acceder a mi panel" },
    ],
  },
  {
    title: "Cuenta",
    links: [
      { href: "/auth/login", label: "Iniciar sesión" },
      { href: "/auth/register", label: "Crear cuenta" },
      { href: "/auth/forgot-password", label: "Recuperar contraseña" },
    ],
  },
];

/**
 * Marketing footer. Only links to routes that exist today — no
 * placeholder "About us" / "Careers" / social links invented, per the
 * brief's instruction not to fabricate content. Legal links are left out
 * entirely rather than pointed at non-existent pages; add them once
 * terms/privacy pages exist.
 */
export function SiteFooter() {
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-border bg-muted/40">
      <div className="container grid gap-10 py-14 sm:grid-cols-2 lg:grid-cols-4">
        <div className="flex flex-col gap-3 lg:col-span-1">
          <Link href="/" className="flex items-center gap-2 text-lg font-bold text-foreground">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              M
            </span>
            MaestroYa
          </Link>
          <p className="max-w-xs text-sm text-muted-foreground">
            Conectamos a personas que necesitan un servicio para el hogar con profesionales de
            confianza cerca de ellas.
          </p>
        </div>

        {COLUMNS.map((column) => (
          <div key={column.title} className="flex flex-col gap-3">
            <h3 className="text-sm font-semibold text-foreground">{column.title}</h3>
            <ul className="flex flex-col gap-2">
              {column.links.map((link) => (
                <li key={link.label}>
                  <Link
                    href={link.href}
                    className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <div className="border-t border-border">
        <div className="container flex flex-col items-center justify-between gap-3 py-6 text-xs text-muted-foreground sm:flex-row">
          <p>© {year} MaestroYa. Todos los derechos reservados.</p>
          <p>Hecho en España para el hogar español.</p>
        </div>
      </div>
    </footer>
  );
}
