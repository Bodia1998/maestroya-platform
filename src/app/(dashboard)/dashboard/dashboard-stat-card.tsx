import Link from "next/link";
import type { LucideIcon } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";

export interface DashboardStatCardProps {
  icon: LucideIcon;
  label: string;
  value: number;
  href: string;
}

/** Small clickable KPI tile used across the Dashboard overview's stat row. */
export function DashboardStatCard({ icon: Icon, label, value, href }: DashboardStatCardProps) {
  return (
    <Link href={href} className="block">
      <Card className="h-full transition-colors hover:border-primary/40">
        <CardContent className="flex items-center gap-4 p-5">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Icon className="h-5 w-5" aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="text-2xl font-semibold leading-none">{value}</p>
            <p className="mt-1 truncate text-sm text-muted-foreground">{label}</p>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
