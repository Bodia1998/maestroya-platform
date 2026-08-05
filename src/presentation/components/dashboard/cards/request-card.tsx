import { StatusBadge } from "@/components/dashboard/status-badge";
import { LinkCard } from "@/components/ui/card";

export interface RequestCardProps {
  href: string;
  title: string;
  status: string;
  categoryName?: string;
  city?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

/** Service request list-item card — same data every "My requests" list already rendered inline, just restyled. */
export function RequestCard({ href, title, status, categoryName, city, createdAt, updatedAt }: RequestCardProps) {
  return (
    <LinkCard href={href} cardClassName="flex flex-col gap-2 p-4">
      <div className="flex items-center justify-between gap-4">
        <h3 className="min-w-0 truncate font-medium text-foreground">{title}</h3>
        <StatusBadge status={status} />
      </div>
      {categoryName && <p className="text-sm text-muted-foreground">{categoryName}</p>}
      {city && <p className="text-sm text-muted-foreground">{city}</p>}
      {createdAt && updatedAt && (
        <p className="text-xs text-muted-foreground/80">
          Posted {createdAt.toLocaleDateString()} — updated {updatedAt.toLocaleDateString()}
        </p>
      )}
    </LinkCard>
  );
}
