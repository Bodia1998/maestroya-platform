import { ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";

import { StatusBadge } from "@/components/dashboard/status-badge";
import { LinkCard } from "@/components/ui/card";

export interface CompanyCardProps {
  href: string;
  name: string;
  status: string;
  actionLabel?: string;
}

/** Company list-item card — same data the "My companies" list already rendered inline, just restyled. */
export function CompanyCard({ href, name, status, actionLabel }: CompanyCardProps) {
  const t = useTranslations("dashboard.cards");
  return (
    <LinkCard href={href} cardClassName="flex items-center justify-between gap-3 p-4">
      <div className="min-w-0">
        <p className="truncate font-medium text-foreground">{name}</p>
        <div className="mt-1">
          <StatusBadge status={status} />
        </div>
      </div>
      <span className="flex shrink-0 items-center gap-1 text-sm font-medium text-primary">
        {actionLabel ?? t("manage")}
        <ChevronRight className="h-4 w-4" aria-hidden />
      </span>
    </LinkCard>
  );
}
