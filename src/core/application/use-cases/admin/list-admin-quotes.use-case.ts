import type { AdminQuoteRecord, AdminRepository, ListAdminQuotesOptions } from "@/domain/repositories/admin-repository";

/** Admin Panel module (Module 16): paginated, status-filterable quote
 *  oversight. Strictly read-only — see the module spec's 5.5. */
export class ListAdminQuotesUseCase {
  constructor(private readonly admins: AdminRepository) {}

  async execute(options: ListAdminQuotesOptions): Promise<AdminQuoteRecord[]> {
    return this.admins.listQuotes(options);
  }
}
