import { NotFoundError } from "@/domain/errors/domain-error";
import type { AdminCompanyRecord, AdminRepository } from "@/domain/repositories/admin-repository";

/** Module 18 — Company Professional: full admin detail view for one company. */
export class GetAdminCompanyUseCase {
  constructor(private readonly admins: AdminRepository) {}

  async execute(companyId: string): Promise<AdminCompanyRecord> {
    const company = await this.admins.getCompanyById(companyId);
    if (!company) throw new NotFoundError("Company", companyId);
    return company;
  }
}
