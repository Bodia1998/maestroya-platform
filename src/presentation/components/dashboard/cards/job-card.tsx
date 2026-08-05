import { StatusBadge } from "@/components/dashboard/status-badge";
import { LinkCard } from "@/components/ui/card";

export interface JobCardProps {
  href: string;
  title: string;
  status: string;
  counterpartyName?: string | null;
}

/** Job list-item card — same data every "My jobs" list already rendered inline, just restyled. */
export function JobCard({ href, title, status, counterpartyName }: JobCardProps) {
  return (
    <LinkCard href={href} cardClassName="flex flex-col gap-2 p-4">
      <div className="flex items-center justify-between gap-4">
        <h3 className="min-w-0 truncate font-medium text-foreground">{title}</h3>
        <StatusBadge status={status} />
      </div>
      {counterpartyName && <p className="text-sm text-muted-foreground">with {counterpartyName}</p>}
    </LinkCard>
  );
}
