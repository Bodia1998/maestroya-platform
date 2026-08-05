import Link from "next/link";

import { StatusBadge } from "@/components/dashboard/status-badge";
import { Card } from "@/components/ui/card";

export interface JobCardProps {
  href: string;
  title: string;
  status: string;
  counterpartyName?: string | null;
}

/** Job list-item card — same data every "My jobs" list already rendered inline, just restyled. */
export function JobCard({ href, title, status, counterpartyName }: JobCardProps) {
  return (
    <Link href={href} className="block rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
      <Card className="flex flex-col gap-2 p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md">
        <div className="flex items-center justify-between gap-4">
          <h3 className="min-w-0 truncate font-medium text-foreground">{title}</h3>
          <StatusBadge status={status} />
        </div>
        {counterpartyName && <p className="text-sm text-muted-foreground">with {counterpartyName}</p>}
      </Card>
    </Link>
  );
}
