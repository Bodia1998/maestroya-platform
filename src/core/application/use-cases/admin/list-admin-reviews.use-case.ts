import type { AdminRepository, AdminReviewRecord, ListAdminReviewsOptions } from "@/domain/repositories/admin-repository";

/** Admin Panel module (Module 16): paginated, status-filterable review
 *  oversight — every status (including FLAGGED/REMOVED) is visible here,
 *  unlike the public-facing listing (see PrismaReviewRepository, which
 *  only ever surfaces PUBLISHED). */
export class ListAdminReviewsUseCase {
  constructor(private readonly admins: AdminRepository) {}

  async execute(options: ListAdminReviewsOptions): Promise<AdminReviewRecord[]> {
    return this.admins.listReviews(options);
  }
}
