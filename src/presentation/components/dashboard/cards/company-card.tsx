import { ChevronRight } from "lucide-react";

import { StatusBadge } from "@/components/dashboard/status-badge";
import { LinkCard } from "@/components/ui/card";

export interface CompanyCardProps {
  href: string;
  name: string;
  status: string;
  actionLabel?: string;
}

/** Company list-item card — same data the "My companies" list already rendered inline, just restyled. */
export function CompanyCard({ href, name, status, actionLabel = "Manage" }: CompanyCardProps) {
  return (
    <LinkCard href={href} cardClassName="flex items-center justify-between gap-3 p-4">
      <div className="min-w-0">
        <p className="truncate font-medium text-foreground">{name}</p>
        <div className="mt-1">
          <StatusBadge status={status} />
        </div>
      </div>
      <span className="flex shrink-0 items-center gap-1 text-sm font-medium text-primary">
        {actionLabel}
        <ChevronRight className="h-4 w-4" aria-hidden />
      </span>
    </LinkCard>
  );
}
