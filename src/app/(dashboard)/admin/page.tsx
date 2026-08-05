import { makeGetAdminDashboardOverviewUseCase } from "@/application/use-cases/admin/compose";
import { PageHeader } from "@/components/dashboard/page-header";
import { Card, CardContent } from "@/components/ui/card";

export const metadata = { title: "Admin overview" };

export const dynamic = "force-dynamic";

const CARDS: Array<{ key: string; label: string }> = [
  { key: "totalUsers", label: "Total users" },
  { key: "totalProfessionals", label: "Professional profiles" },
  { key: "totalServiceRequests", label: "Service requests" },
  { key: "totalQuotes", label: "Quotes" },
  { key: "totalAppointments", label: "Appointments" },
  { key: "totalJobs", label: "Jobs" },
  { key: "totalReviews", label: "Reviews" },
  { key: "totalPortfolioItems", label: "Portfolio items" },
  { key: "totalNotifications", label: "Notifications (active)" },
  { key: "unreadNotifications", label: "Unread notifications" },
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
    <div className="flex flex-col gap-6">
      <PageHeader title="Admin overview" subtitle="Platform-wide operational counts." />
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        {CARDS.map((card) => (
          <Card key={card.key}>
            <CardContent className="p-4">
              <p className="text-2xl font-semibold">{data[card.key]}</p>
              <p className="mt-1 text-xs text-foreground/70">{card.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
