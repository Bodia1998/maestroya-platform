import { StatusBadge } from "@/components/dashboard/status-badge";
import { LinkCard } from "@/components/ui/card";

export interface AppointmentCardProps {
  href: string;
  title: string;
  status: string;
  counterpartyName?: string | null;
  window?: string;
}

/** Appointment list-item card — same data every "My appointments" list already rendered inline, just restyled. */
export function AppointmentCard({ href, title, status, counterpartyName, window }: AppointmentCardProps) {
  return (
    <LinkCard href={href} cardClassName="flex flex-col gap-2 p-4">
      <div className="flex items-center justify-between gap-4">
        <h3 className="min-w-0 truncate font-medium text-foreground">{title}</h3>
        <StatusBadge status={status} />
      </div>
      {counterpartyName && <p className="text-sm text-muted-foreground">with {counterpartyName}</p>}
      {window && <p className="text-sm text-muted-foreground">{window}</p>}
    </LinkCard>
  );
}
