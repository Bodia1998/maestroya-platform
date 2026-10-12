import Link from "next/link";
import { useTranslations } from "next-intl";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/shared/utils/cn";
import type { LeadAdminEvidenceBasis } from "@/domain/services/lead-admin-console";

/** Presentation helpers shared by the lead console pages. No data access, no authorization. */

export function formatWhen(date: Date | null | undefined): string {
  if (!date) return "—";
  return `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

/** Tells the operator HOW MUCH to trust a line: a recorded fact, an audit entry, a derived indicator or a heuristic signal. */
export function BasisBadge({ basis }: { basis: LeadAdminEvidenceBasis }) {
  const t = useTranslations("admin.leadOps.basis");
  return (
    <Badge variant={basis === "DERIVED" || basis === "HEURISTIC_SIGNAL" ? "outline" : "secondary"} title={t(`${basis}Hint` as never)}>
      {t(basis)}
    </Badge>
  );
}

export function SectionNav({ active }: { active: "leads" | "claims" | "disputes" | "abuse" }) {
  const t = useTranslations("admin.leadOps.sections");
  const items = [
    ["leads", "/admin/leads"],
    ["claims", "/admin/leads/claims"],
    ["disputes", "/admin/leads/disputes"],
    ["abuse", "/admin/leads/abuse"],
  ] as const;
  return (
    <nav aria-label={t("label")} className="flex flex-wrap gap-2">
      {items.map(([key, href]) => (
        <Link
          key={key}
          href={href}
          aria-current={active === key ? "page" : undefined}
          className={cn(
            "inline-flex min-h-10 items-center rounded-md border px-3 text-sm font-medium",
            active === key ? "border-primary bg-primary/10 text-primary" : "text-foreground/75 hover:bg-muted",
          )}
        >
          {t(key)}
        </Link>
      ))}
    </nav>
  );
}

export function PrivacyNote() {
  const t = useTranslations("admin.leadOps");
  return <p className="text-sm text-muted-foreground">{t("privacyNote")}</p>;
}

/** Module 159 — read-only display of the LEAD_V1 rollout switch (M157 "kill-switch visibility"). Changes nothing. */
export function RolloutModeNote({ mode, misconfigured }: { mode: string; misconfigured: boolean }) {
  const t = useTranslations("admin.leadOps");
  return (
    <p role="status" className="text-sm text-muted-foreground">
      <span className="font-medium">{t("rolloutMode", { mode })}</span>
      {misconfigured ? <span> — {t("rolloutMisconfigured")}</span> : null}
    </p>
  );
}

/** Shortens an opaque id for display; the full id stays in the title/link. */
export function ShortId({ id, href }: { id: string; href?: string }) {
  const label = id.slice(0, 8);
  return href ? (
    <Link href={href} title={id} className="font-mono text-primary underline-offset-2 hover:underline">
      {label}
    </Link>
  ) : (
    <span title={id} className="font-mono">
      {label}
    </span>
  );
}
