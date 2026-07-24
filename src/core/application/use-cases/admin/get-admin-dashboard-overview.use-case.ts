import type { AdminDashboardOverview, AdminRepository } from "@/domain/repositories/admin-repository";

/**
 * Admin Panel module (Module 16): operational counts only — no charts, no
 * trends, no financial figures. See the module spec's "Admin Dashboard
 * Overview" section for the exact boundary. Every count is a single
 * efficient aggregate query (see PrismaAdminRepository.getDashboardOverview),
 * never an N+1 loop.
 */
export class GetAdminDashboardOverviewUseCase {
  constructor(private readonly admins: AdminRepository) {}

  async execute(): Promise<AdminDashboardOverview> {
    return this.admins.getDashboardOverview();
  }
}
