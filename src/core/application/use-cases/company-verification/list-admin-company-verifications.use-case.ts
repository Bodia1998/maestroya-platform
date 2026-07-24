import type {
  AdminCompanyVerificationListItem,
  CompanyVerificationRepository,
  ListAdminCompanyVerificationsOptions,
} from "@/domain/repositories/company-verification-repository";

/** Module 18 — Company Professional: paginated admin queue. Mirrors
 *  ListAdminVerificationsUseCase. Caller authorization enforced at the
 *  Server Action boundary via requireRole(). */
export class ListAdminCompanyVerificationsUseCase {
  constructor(private readonly verifications: CompanyVerificationRepository) {}

  async execute(options: ListAdminCompanyVerificationsOptions): Promise<AdminCompanyVerificationListItem[]> {
    return this.verifications.listForAdmin(options);
  }
}
