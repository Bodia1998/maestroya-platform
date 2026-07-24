import type { AdminCompanyRecord, AdminRepository, ListAdminCompaniesOptions } from "@/domain/repositories/admin-repository";

/** Module 18 — Company Professional: paginated, searchable, status-filterable
 *  admin company oversight list. Caller authorization enforced at the
 *  Server Action boundary via requireRole(). */
export class ListAdminCompaniesUseCase {
  constructor(private readonly admins: AdminRepository) {}

  async execute(options: ListAdminCompaniesOptions): Promise<AdminCompanyRecord[]> {
    return this.admins.listCompanies(options);
  }
}
