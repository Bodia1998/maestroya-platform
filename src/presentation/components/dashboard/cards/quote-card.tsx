import Link from "next/link";

import { StatusBadge } from "@/components/dashboard/status-badge";
import { Card } from "@/components/ui/card";

export interface QuoteCardProps {
  href: string;
  title: string;
  status: string;
  categoryName?: string;
  amountLabel?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

/** Quote list-item card — same data every "My quotes" list already rendered inline, just restyled. */
export function QuoteCard({ href, title, status, categoryName, amountLabel, createdAt, updatedAt }: QuoteCardProps) {
  return (
    <Link href={href} className="block rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
      <Card className="flex flex-col gap-2 p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md">
        <div className="flex items-center justify-between gap-4">
          <h3 className="min-w-0 truncate font-medium text-foreground">{title}</h3>
          <StatusBadge status={status} />
        </div>
        {categoryName && <p className="text-sm text-muted-foreground">{categoryName}</p>}
        {amountLabel && <p className="text-sm font-medium text-foreground">{amountLabel}</p>}
        {createdAt && updatedAt && (
          <p className="text-xs text-muted-foreground/80">
            Submitted {createdAt.toLocaleDateString()} — updated {updatedAt.toLocaleDateString()}
          </p>
        )}
      </Card>
    </Link>
  );
}
