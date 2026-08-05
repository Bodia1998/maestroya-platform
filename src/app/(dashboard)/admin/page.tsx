import {
  Award,
  Bell,
  BellRing,
  Briefcase,
  CalendarDays,
  FileSignature,
  FileText,
  Image as ImageIcon,
  Star,
  Users,
} from "lucide-react";

import { makeGetAdminDashboardOverviewUseCase } from "@/application/use-cases/admin/compose";
import { PageHeader } from "@/components/dashboard/page-header";
import { KPICard } from "@/components/dashboard/kpi-card";
import { Heading } from "@/components/ui/typography";

export const metadata = { title: "Admin overview" };

export const dynamic = "force-dynamic";

const CARDS: Array<{ key: string; label: string; icon: typeof Users; href?: string }> = [
  { key: "totalUsers", label: "Total users", icon: Users, href: "/admin/users" },
  { key: "totalProfessionals", label: "Professional profiles", icon: Award, href: "/admin/professionals" },
  { key: "totalServiceRequests", label: "Service requests", icon: FileText, href: "/admin/service-requests" },
  { key: "totalQuotes", label: "Quotes", icon: FileSignature, href: "/admin/quotes" },
  { key: "totalAppointments", label: "Appointments", icon: CalendarDays },
  { key: "totalJobs", label: "Jobs", icon: Briefcase, href: "/admin/jobs" },
  { key: "totalReviews", label: "Reviews", icon: Star, href: "/admin/reviews" },
  { key: "totalPortfolioItems", label: "Portfolio items", icon: ImageIcon, href: "/admin/portfolio" },
  { key: "totalNotifications", label: "Notifications (active)", icon: Bell },
  { key: "unreadNotifications", label: "Unread notifications", icon: BellRing },
];

/**
 * Admin Panel module (Module 16): operational counts only, computed by a
 * handful of efficient aggregate queries (see
 * PrismaAdminRepository.getDashboardOverview) — no charts, no trends, no
 * financial figures. See the module spec's "Admin Dashboard Overview"
 * section and docs/MODULE_16_ADMIN_PANEL.md for the deliberate boundary
 * with a future Analytics module.
 */
export default async function AdminOverviewPage() {
  const overview = await makeGetAdminDashboardOverviewUseCase().execute();
  const data = overview as unknown as Record<string, number>;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader title="Admin overview" subtitle="Platform-wide operational counts." />

      <section className="flex flex-col gap-4">
        <Heading as="h2" level="h6">
          Marketplace activity
        </Heading>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {CARDS.map((card) => (
            <KPICard
              key={card.key}
              icon={card.icon}
              label={card.label}
              value={data[card.key] ?? 0}
              href={card.href}
            />
          ))}
        </div>
      </section>
    </div>
  );
}
