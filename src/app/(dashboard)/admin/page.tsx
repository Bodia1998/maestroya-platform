import { makeGetAdminDashboardOverviewUseCase } from "@/application/use-cases/admin/compose";

export const metadata = { title: "Admin overview" };

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
      <div>
        <h1 className="text-2xl font-semibold">Admin overview</h1>
        <p className="mt-1 text-sm text-foreground/70">Platform-wide operational counts.</p>
      </div>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        {CARDS.map((card) => (
          <div key={card.key} className="rounded-md border border-border p-4">
            <p className="text-2xl font-semibold">{data[card.key]}</p>
            <p className="mt-1 text-xs text-foreground/70">{card.label}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
