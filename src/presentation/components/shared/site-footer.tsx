import Link from "next/link";
import { useTranslations } from "next-intl";

/**
 * Module 120 — Multilingual Localization: hrefs stay here, labels are
 * catalog keys — `nav.*` where the header already has the same label,
 * `marketing.footer.*` for footer-only text.
 */
type FooterLabel = { ns: "nav"; key: "search" | "services" | "locations" | "register" | "howItWorks" | "login" }
  | { ns: "footer"; key: "directory" | "joinAsProfessional" | "professionalDashboard" | "forgotPassword" };

const COLUMNS: Array<{
  titleKey: "customers" | "professionals" | "account";
  links: Array<{ href: string; label: FooterLabel }>;
}> = [
  {
    titleKey: "customers",
    links: [
      { href: "/search", label: { ns: "nav", key: "search" } },
      { href: "/professionals", label: { ns: "footer", key: "directory" } },
      // Module 118 — AI-Readable Service & Location Knowledge.
      { href: "/servicios", label: { ns: "nav", key: "services" } },
      { href: "/ubicaciones", label: { ns: "nav", key: "locations" } },
      { href: "/auth/register", label: { ns: "nav", key: "register" } },
      { href: "/#como-funciona", label: { ns: "nav", key: "howItWorks" } },
    ],
  },
  {
    titleKey: "professionals",
    links: [
      { href: "/auth/register", label: { ns: "footer", key: "joinAsProfessional" } },
      { href: "/auth/login", label: { ns: "footer", key: "professionalDashboard" } },
    ],
  },
  {
    titleKey: "account",
    links: [
      { href: "/auth/login", label: { ns: "nav", key: "login" } },
      { href: "/auth/register", label: { ns: "nav", key: "register" } },
      { href: "/auth/forgot-password", label: { ns: "footer", key: "forgotPassword" } },
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
  const t = useTranslations("marketing");
  const tNav = useTranslations("nav");
  const year = new Date().getFullYear();
  const labelOf = (label: FooterLabel) =>
    label.ns === "nav" ? tNav(label.key) : t(`footer.${label.key}`);

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
            {t("footer.tagline")}
          </p>
        </div>

        {COLUMNS.map((column) => (
          <div key={column.titleKey} className="flex flex-col gap-3">
            <h3 className="text-sm font-semibold text-foreground">{t(`footer.${column.titleKey}`)}</h3>
            <ul className="flex flex-col gap-2">
              {column.links.map((link) => (
                <li key={`${link.label.ns}.${link.label.key}`}>
                  <Link
                    href={link.href}
                    className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                  >
                    {labelOf(link.label)}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <div className="border-t border-border">
        <div className="container flex flex-col items-center justify-between gap-3 py-6 text-xs text-muted-foreground sm:flex-row">
          <p>{t("footer.rights", { year: String(year) })}</p>
          <p>{t("footer.madeIn")}</p>
        </div>
      </div>
    </footer>
  );
}
