import Link from "next/link";
import { ChevronRight } from "lucide-react";

import { StatusBadge } from "@/components/dashboard/status-badge";
import { Card } from "@/components/ui/card";

export interface CompanyCardProps {
  href: string;
  name: string;
  status: string;
  actionLabel?: string;
}

/** Company list-item card — same data the "My companies" list already rendered inline, just restyled. */
export function CompanyCard({ href, name, status, actionLabel = "Manage" }: CompanyCardProps) {
  return (
    <Link href={href} className="block rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
      <Card className="flex items-center justify-between gap-3 p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md">
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
      </Card>
    </Link>
  );
}
