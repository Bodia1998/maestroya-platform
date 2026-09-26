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
import { getTranslations } from "next-intl/server";

import { makeGetAdminDashboardOverviewUseCase } from "@/application/use-cases/admin/compose";
import { PageHeader } from "@/components/dashboard/page-header";
import { KPICard } from "@/components/dashboard/kpi-card";
import { ResponsiveGrid } from "@/components/layout/responsive-grid";
import { Heading } from "@/components/ui/typography";

export async function generateMetadata() {
  const t = await getTranslations("admin.overview");
  return { title: t("title") };
}

export const dynamic = "force-dynamic";

type OverviewCardKey =
  | "totalUsers"
  | "totalProfessionals"
  | "totalServiceRequests"
  | "totalQuotes"
  | "totalAppointments"
  | "totalJobs"
  | "totalReviews"
  | "totalPortfolioItems"
  | "totalNotifications"
  | "unreadNotifications";

const CARDS: Array<{ key: OverviewCardKey; icon: typeof Users; href?: string }> = [
  { key: "totalUsers", icon: Users, href: "/admin/users" },
  { key: "totalProfessionals", icon: Award, href: "/admin/professionals" },
  { key: "totalServiceRequests", icon: FileText, href: "/admin/service-requests" },
  { key: "totalQuotes", icon: FileSignature, href: "/admin/quotes" },
  { key: "totalAppointments", icon: CalendarDays },
  { key: "totalJobs", icon: Briefcase, href: "/admin/jobs" },
  { key: "totalReviews", icon: Star, href: "/admin/reviews" },
  { key: "totalPortfolioItems", icon: ImageIcon, href: "/admin/portfolio" },
  { key: "totalNotifications", icon: Bell },
  { key: "unreadNotifications", icon: BellRing },
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
  const t = await getTranslations("admin.overview");

  return (
    <div className="flex flex-col gap-8">
      <PageHeader title={t("title")} subtitle={t("subtitle")} />

      <section className="flex flex-col gap-4">
        <Heading as="h2" level="h6">
          {t("marketplaceActivity")}
        </Heading>
        <ResponsiveGrid cols="1-2-4">
          {CARDS.map((card) => (
            <KPICard
              key={card.key}
              icon={card.icon}
              label={t(`cards.${card.key}`)}

              value={data[card.key] ?? 0}
              href={card.href}
            />
          ))}
        </ResponsiveGrid>
      </section>
    </div>
  );
}
