import { StatusBadge } from "@/components/dashboard/status-badge";
import { LinkCard } from "@/components/ui/card";

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
    <LinkCard href={href} cardClassName="flex flex-col gap-2 p-4">
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
    </LinkCard>
  );
}
