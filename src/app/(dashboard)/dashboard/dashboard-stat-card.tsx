import type { LucideIcon } from "lucide-react";

import { KPICard } from "@/components/dashboard/kpi-card";

export interface DashboardStatCardProps {
  icon: LucideIcon;
  label: string;
  value: number;
  href: string;
}

/**
 * Small clickable KPI tile used across the Dashboard overview's stat row.
 * Thin wrapper around the shared `KPICard` (Module 30.3) — kept as its own
 * named export so existing imports across dashboard/page.tsx keep working
 * unchanged.
 */
export function DashboardStatCard({ icon, label, value, href }: DashboardStatCardProps) {
  return <KPICard icon={icon} label={label} value={value} href={href} />;
}
